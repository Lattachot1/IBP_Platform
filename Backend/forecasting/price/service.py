"""
Sale-price forecast service: backtest each candidate per grade, crown a
champion with a nested split, build horizon-aware intervals, and expose a
JSON-serialisable engine that doubles as the on-disk artifact.

Protocol
- Rolling-origin, monthly-stepped, expanding-window backtest: 16 folds x
  horizon 3. Inside every fold the future BD path is held at the last known
  level (no leakage), which is exactly what the live "base" scenario does.
- Nested selection: the champion is chosen on the earlier folds only; the
  last 4 folds are reported separately as untouched hold-out error, so the
  headline number is not the one the selection was made on.
- Intervals: per-horizon 80% quantiles of |residual| from the champion's
  folds (never shrinking with h); beyond the backtested horizon a sqrt(h)
  extrapolation of the pooled standardized residuals. Hold-out coverage is
  reported next to the nominal level.
- The engine dict contains only plain Python types, so it is written as the
  artifact (train job -> artifact -> serve) and reloaded without refitting.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .. import data as billing_data
from . import data
from .models import (
    ENSEMBLE,
    ETS,
    MODEL_NAMES,
    NAIVE,
    PASS_THROUGH,
    fit_passthrough,
    forecast_ets,
    forecast_passthrough,
    model_forecast,
)

log = logging.getLogger("ibp.price")

ARTIFACT_VERSION = "sale-price-passthrough-v1"
DEFAULT_ARTIFACT_PATH = Path(__file__).resolve().parents[2] / "artifacts" / "sale_price_forecast.json"

HORIZON = 3
FOLD_MONTHS = 16
HOLDOUT_FOLDS = 4
MIN_TRAIN_MONTHS = 24
MAX_HORIZON = 6
INTERVAL_LEVEL_PCT = 80
SCENARIOS = {"low": -15.0, "base": 0.0, "high": 15.0}


# ----------------------------------------------------------------------------
# Backtest helpers
# ----------------------------------------------------------------------------
def _folds(frame: pd.DataFrame, horizon: int = HORIZON, n_folds: int = FOLD_MONTHS) -> list:
    """Monthly-stepped expanding-window folds, oldest first, each with a full-horizon test."""
    n = len(frame)
    folds = []
    for k in range(n_folds + horizon - 1, horizon - 1, -1):
        cutoff = n - k
        if cutoff < MIN_TRAIN_MONTHS:
            continue
        folds.append((frame.iloc[:cutoff], frame.iloc[cutoff:cutoff + horizon]))
    return folds


def _mape(actual, predicted) -> float:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    mask = actual != 0
    if not mask.any():
        return float("nan")
    return float(np.mean(np.abs(actual[mask] - predicted[mask]) / np.abs(actual[mask])))


def _wape(actual, predicted) -> float:
    actual = np.asarray(actual, dtype=float)
    denom = np.abs(actual).sum()
    if denom == 0:
        return float("nan")
    return float(np.abs(actual - np.asarray(predicted, dtype=float)).sum() / denom)


def _finite(value, digits=None):
    """float rounded for JSON, or None when missing / NaN / inf."""
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    return round(value, digits) if digits is not None else value


def _metrics(folds: list, preds: list) -> dict:
    actual = np.concatenate([te["p"].to_numpy(dtype=float) for _, te in folds])
    predicted = np.concatenate(preds)
    horizon = len(folds[0][1])
    mape_h = {}
    for h in range(1, horizon + 1):
        a = np.array([te["p"].to_numpy(dtype=float)[h - 1] for _, te in folds if len(te) >= h])
        p = np.array([pr[h - 1] for (_, te), pr in zip(folds, preds) if len(te) >= h])
        mape_h[str(h)] = _finite(_mape(a, p))
    return {"mape": _finite(_mape(actual, predicted)), "wape": _finite(_wape(actual, predicted)), "mape_h": mape_h}


def _history_rows(price_frame: pd.DataFrame, bd: pd.Series) -> list:
    joined = price_frame.join(bd.rename("bd"), how="left")
    rows = []
    for period, row in joined.iterrows():
        rows.append({
            "period": str(period),
            "fob_price": _finite(row["fob_price"], 2),
            "net_price": _finite(row["net_price"], 2),
            "qty": _finite(row["qty"], 2),
            "bd": _finite(row["bd"], 2),
        })
    return rows


# ----------------------------------------------------------------------------
# Training
# ----------------------------------------------------------------------------
def train_grade(grade: str, frame: pd.DataFrame, price_frame: pd.DataFrame = None, bd: pd.Series = None) -> dict:
    """Backtest every candidate on one grade, crown a champion, fit it on the full series."""
    folds = _folds(frame)
    if len(folds) < 6:
        raise ValueError(f"{grade}: only {len(folds)} backtest folds (need at least 6)")

    preds = {}
    for name in MODEL_NAMES:
        preds[name] = [
            # future BD held at the last known level: no leakage, same as the live base scenario
            model_forecast(name, tr, HORIZON, np.repeat(tr["bd0"].to_numpy(dtype=float)[-1], HORIZON))
            for tr, _ in folds
        ]

    n_select = len(folds) - HOLDOUT_FOLDS if len(folds) >= HOLDOUT_FOLDS + 4 else len(folds)
    select_folds, hold_folds = folds[:n_select], folds[n_select:]

    leaderboard = {}
    for name in MODEL_NAMES:
        m_all = _metrics(folds, preds[name])
        m_sel = _metrics(select_folds, preds[name][:n_select])
        m_hold = _metrics(hold_folds, preds[name][n_select:]) if hold_folds else None
        leaderboard[name] = {
            "mape": m_all["mape"],
            "wape": m_all["wape"],
            "mape_h": m_all["mape_h"],
            "mape_select": m_sel["mape"],
            "mape_holdout": m_hold["mape"] if m_hold else None,
        }

    eligible = [n for n in MODEL_NAMES if leaderboard[n]["mape_select"] is not None]
    if not eligible:
        raise ValueError(f"{grade}: no model produced a finite error")
    champion = min(eligible, key=lambda n: leaderboard[n]["mape_select"])

    # Symmetric residual bands per horizon from the champion's folds, measured
    # as a fraction of the actual price: prices moved from about 1,500 to
    # 3,000 USD/t over the sample, so a band in absolute USD calibrated on the
    # early folds would be far too narrow at today's level.
    q = INTERVAL_LEVEL_PCT / 100.0
    res_h = {
        h: np.array([
            abs(te["p"].to_numpy(dtype=float)[h - 1] - pr[h - 1]) / abs(te["p"].to_numpy(dtype=float)[h - 1])
            for (_, te), pr in zip(folds, preds[champion])
        ])
        for h in range(1, HORIZON + 1)
    }
    q_band, running = {}, 0.0
    for h in range(1, HORIZON + 1):
        running = max(running, float(np.quantile(res_h[h], q)))
        q_band[str(h)] = running
    std_pool = np.concatenate([res_h[h] / math.sqrt(h) for h in range(1, HORIZON + 1)])
    std_q = float(np.quantile(std_pool, q))

    # Honest coverage: calibrate on the earlier folds, check on the last hold-out folds
    coverage = None
    if hold_folds:
        n_cal = len(folds) - len(hold_folds)
        inside = []
        for h in range(1, HORIZON + 1):
            q_cal = float(np.quantile(res_h[h][:n_cal], q))
            inside.append(res_h[h][n_cal:] <= q_cal)
        coverage = float(np.concatenate(inside).mean())

    y = frame["p"].to_numpy(dtype=float)
    coef = fit_passthrough(frame)
    history = _history_rows(price_frame, bd) if price_frame is not None and bd is not None else []

    return {
        "grade": grade,
        "champion": champion,
        "leaderboard": leaderboard,
        "mape": leaderboard[champion]["mape"],
        "wape": leaderboard[champion]["wape"],
        "mape_h": leaderboard[champion]["mape_h"],
        "mape_select": leaderboard[champion]["mape_select"],
        "mape_holdout": leaderboard[champion]["mape_holdout"],
        "naive_mape": leaderboard[NAIVE]["mape"],
        "naive_mape_holdout": leaderboard[NAIVE]["mape_holdout"],
        "interval_level_pct": INTERVAL_LEVEL_PCT,
        "interval_basis": "relative",
        "q_band": q_band,
        "std_q": std_q,
        "coverage_empirical": coverage,
        "coef": [float(c) for c in coef],
        "last_price": float(y[-1]),
        "bd_last": float(frame["bd0"].to_numpy(dtype=float)[-1]),
        "bd_prev": float(frame["bd1"].to_numpy(dtype=float)[-1]),
        "ets_baseline": [float(v) for v in forecast_ets(y, MAX_HORIZON)],
        "months": int(len(frame)),
        "avg_price": float(y.mean()),
        "trained_through": str(frame.index[-1]),
        "folds": len(folds),
        "select_folds": n_select,
        "holdout_folds": len(hold_folds),
        "history": history,
    }


def train_all(billing_path=None, bd_file=None) -> dict:
    """Train every target grade; the returned dict is the artifact."""
    bd = data.load_bd_monthly(bd_file)
    prices = data.price_series(path=billing_path)
    if not prices:
        raise RuntimeError("no usable price series in the billing data")

    grades = {}
    for grade, price_frame in prices.items():
        frame = data.aligned_frame(price_frame, bd)
        try:
            grades[grade] = train_grade(grade, frame, price_frame, bd)
        except Exception as exc:
            log.warning("[Price] skipping grade %s: %s", grade, exc)
    if not grades:
        raise RuntimeError("every grade failed to train")

    return {
        "artifact_version": ARTIFACT_VERSION,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "target": "FOB selling price, USD per ton, tonnage-weighted monthly average",
        "bd_symbol": data.BD_SYMBOL,
        "bd_last_month": str(bd.index[-1]),
        "bd_last": float(bd.iloc[-1]),
        "protocol": {
            "backtest": f"rolling-origin, monthly-stepped, expanding window, {FOLD_MONTHS} folds x horizon {HORIZON}",
            "selection": f"champion chosen on the earlier folds; last {HOLDOUT_FOLDS} folds reported as hold-out",
            "bd_in_backtest": "held at the last known level inside every fold (no leakage)",
            "interval": f"{INTERVAL_LEVEL_PCT}% band from per-horizon quantiles of the relative residual, sqrt(h) beyond h={HORIZON}",
            "max_horizon": MAX_HORIZON,
        },
        "sources": {
            "billing": str(billing_data.find_source_file(billing_path)),
            "bd": str(data.find_bd_file(bd_file)),
        },
        "grades": grades,
    }


# ----------------------------------------------------------------------------
# Serving
# ----------------------------------------------------------------------------
def interval_offset(info: dict, h: int) -> float:
    """Half-width of the band at horizon h (a fraction of the point forecast when
    interval_basis is 'relative', absolute USD/t otherwise)."""
    if h <= HORIZON:
        return float(info["q_band"][str(h)])
    return float(info["std_q"]) * math.sqrt(h)


def bd_path(info: dict, horizon: int, bd_change_pct: float = 0.0, bd_values=None) -> np.ndarray:
    """BD assumed for months t+1..t+horizon: an explicit path, or last BD shifted by a percentage."""
    if bd_values is not None and len(bd_values):
        values = [float(v) for v in bd_values][:horizon]
        while len(values) < horizon:
            values.append(values[-1])
        return np.array(values)
    level = float(info["bd_last"]) * (1.0 + float(bd_change_pct) / 100.0)
    return np.repeat(max(level, 0.0), horizon)


def forecast(info: dict, horizon: int, bd_change_pct: float = 0.0, bd_values=None) -> dict:
    """Compose the champion's forecast from the cached fit (no refitting) along a BD path.

    Month 1 always uses the last known BD; the scenario applies from month 2.
    """
    horizon = int(max(1, min(MAX_HORIZON, horizon)))
    path = bd_path(info, horizon, bd_change_pct, bd_values)
    last_price = float(info["last_price"])

    naive = np.repeat(last_price, horizon)
    ets = np.asarray(info.get("ets_baseline") or [last_price], dtype=float)
    if len(ets) < horizon:
        ets = np.concatenate([ets, np.repeat(ets[-1], horizon - len(ets))])
    ets = ets[:horizon]
    passthrough = forecast_passthrough(info["coef"], last_price, info["bd_last"], info["bd_prev"], path, horizon)

    champion = info["champion"]
    point = {
        NAIVE: naive,
        ETS: ets,
        PASS_THROUGH: passthrough,
        ENSEMBLE: (passthrough + naive) / 2.0,
    }[champion]

    offsets = np.array([interval_offset(info, i + 1) for i in range(horizon)])
    if info.get("interval_basis", "absolute") == "relative":
        offsets = offsets * point
    last = pd.Period(info["trained_through"], freq="M")
    return {
        "periods": [str(last + i) for i in range(1, horizon + 1)],
        "bd_path": [round(float(v), 2) for v in path],
        "forecast": [round(float(v), 2) for v in point],
        "lower": [round(float(max(v - o, 0.0)), 2) for v, o in zip(point, offsets)],
        "upper": [round(float(v + o), 2) for v, o in zip(point, offsets)],
        "naive": [round(float(v), 2) for v in naive],
        "passthrough": [round(float(v), 2) for v in passthrough],
        "model_name": champion,
    }


def leaderboard_rows(engine: dict) -> list:
    rows = []
    for name, info in engine["grades"].items():
        rows.append({
            "product_id": name,
            "champion": info["champion"],
            "mape": _finite(info.get("mape"), 4),
            "mape_holdout": _finite(info.get("mape_holdout"), 4),
            "naive_mape": _finite(info.get("naive_mape"), 4),
            "naive_mape_holdout": _finite(info.get("naive_mape_holdout"), 4),
            "mape_h1": _finite((info.get("mape_h") or {}).get("1"), 4),
            "mape_h2": _finite((info.get("mape_h") or {}).get("2"), 4),
            "mape_h3": _finite((info.get("mape_h") or {}).get("3"), 4),
            "months": info.get("months"),
            "avg_price": _finite(info.get("avg_price"), 1),
            "last_price": _finite(info.get("last_price"), 1),
            "bd_last": _finite(info.get("bd_last"), 1),
            "trained_through": info.get("trained_through"),
            "interval_level_pct": info.get("interval_level_pct"),
            "coverage_empirical": _finite(info.get("coverage_empirical"), 3),
            "folds": info.get("folds"),
            "holdout_folds": info.get("holdout_folds"),
        })
    return rows


# ----------------------------------------------------------------------------
# Artifact I/O
# ----------------------------------------------------------------------------
REQUIRED_KEYS = {"artifact_version", "trained_at", "grades", "bd_last"}
REQUIRED_GRADE_KEYS = ("champion", "coef", "last_price", "bd_last", "bd_prev", "q_band", "std_q", "trained_through")


def save_artifact(engine: dict, path=DEFAULT_ARTIFACT_PATH) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(engine, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def load_artifact(path=DEFAULT_ARTIFACT_PATH) -> dict:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    missing = REQUIRED_KEYS - set(payload)
    if missing:
        raise ValueError(f"artifact is missing keys: {sorted(missing)}")
    if not payload["grades"]:
        raise ValueError("artifact contains no grades")
    for name, info in payload["grades"].items():
        for key in REQUIRED_GRADE_KEYS:
            if key not in info:
                raise ValueError(f"artifact grade {name} is missing {key}")
    return payload


def load_or_train(path=DEFAULT_ARTIFACT_PATH, billing_path=None, bd_file=None) -> tuple:
    """Serve from the artifact when present; otherwise train once and write it. Returns (engine, source)."""
    path = Path(path)
    if path.exists():
        return load_artifact(path), "artifact"
    engine = train_all(billing_path, bd_file)
    try:
        save_artifact(engine, path)
    except OSError as exc:
        log.warning("[Price] could not write artifact %s: %s", path, exc)
    return engine, "trained"
