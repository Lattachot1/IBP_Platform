"""
Raw-material (butadiene) forecast service.

Keeps the artifact contract of the original model-service (artifact_version,
symbol, commodity, market, unit, forecast_origin, model_name, validation_mae,
readiness, scenario_interpretation, forecasts[] with p025/p10/p50/p90/p975 and
best/base/worst purchase cases) and adds what was missing:

- a reproducible training run: rolling-origin backtest, 18 monthly-stepped
  folds x horizon 4, champion chosen on the earlier folds, last 4 reported as
  hold-out, MAE per horizon (the old artifact carried one MAE for month 1 only)
- quantile bands from signed relative backtest errors per horizon (never
  narrowing with distance), with hold-out coverage of the P10-P90 band
- a scenario path (low = P10, base = P50, high = P90) that the sale-price
  engine consumes as its BD path, so BD -> selling price -> revenue chain
- artifact-first serving: load the trained artifact, train if absent, fall
  back to the 2026-09-13 sample artifact when no BD data file is present
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import data
from .models import MODEL_NAMES, NAIVE, model_forecast

log = logging.getLogger("ibp.rawmat")

DEFAULT_ARTIFACT_PATH = Path(__file__).resolve().parents[2] / "artifacts" / "butadiene_forecast.json"
SAMPLE_ARTIFACT_PATH = Path(__file__).resolve().parent / "samples" / "butadiene_forecast_2026-09-13.json"

HORIZON = 4
FOLD_MONTHS = 18
HOLDOUT_FOLDS = 4
MIN_TRAIN_MONTHS = 24
MAX_HORIZON = 6
QUANTILES = {"p025": 0.025, "p10": 0.10, "p50": 0.50, "p90": 0.90, "p975": 0.975}
SCENARIO_QUANTILE = {"low": "p10", "base": "p50", "high": "p90"}
SCENARIOS = ("flat",) + tuple(SCENARIO_QUANTILE)

READINESS = (
    "Research prototype: butadiene is close to a random walk, so plan on the P10/P50/P90 range "
    "rather than the point, and re-check the hold-out coverage after every month closes."
)
SCENARIO_INTERPRETATION = (
    "P10 is the low-price purchasing case, P50 the base median, P90 the high-price purchasing case. "
    "These are predictive quantiles from a backtest, not guarantees."
)

REQUIRED_KEYS = {
    "artifact_version", "symbol", "commodity", "market", "unit", "forecast_origin", "model_name",
    "validation_mae", "readiness", "scenario_interpretation", "forecasts",
}


# ----------------------------------------------------------------------------
# Artifact validation (same rules as the original model-service, kept verbatim)
# ----------------------------------------------------------------------------
def validate_artifact(payload: dict) -> None:
    missing = REQUIRED_KEYS.difference(payload)
    if missing:
        raise ValueError(f"Forecast artifact is missing fields: {sorted(missing)}")
    forecasts = payload["forecasts"]
    if not forecasts:
        raise ValueError("Forecast artifact contains no forecast rows")
    expected = 1
    for row in forecasts:
        if row.get("horizon") != expected:
            raise ValueError("Forecast horizons must be sequential and start at 1")
        quantiles = [row.get(key) for key in ("p025", "p10", "p50", "p90", "p975")]
        if any(v is None for v in quantiles) or quantiles != sorted(quantiles):
            raise ValueError(f"Invalid forecast quantile order at horizon {expected}")
        expected += 1


# ----------------------------------------------------------------------------
# Backtest
# ----------------------------------------------------------------------------
def _folds(y: np.ndarray, horizon: int = HORIZON, n_folds: int = FOLD_MONTHS) -> list:
    n = len(y)
    folds = []
    for k in range(n_folds + horizon - 1, horizon - 1, -1):
        cutoff = n - k
        if cutoff < MIN_TRAIN_MONTHS:
            continue
        folds.append((y[:cutoff], y[cutoff:cutoff + horizon]))
    return folds


def _mae(actual, predicted) -> float:
    return float(np.mean(np.abs(np.asarray(actual, dtype=float) - np.asarray(predicted, dtype=float))))


def _finite(value, digits=None):
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
    actual = np.concatenate([te for _, te in folds])
    predicted = np.concatenate(preds)
    horizon = len(folds[0][1])
    mae_h = {
        str(h): _finite(_mae([te[h - 1] for _, te in folds], [p[h - 1] for p in preds]), 2)
        for h in range(1, horizon + 1)
    }
    mape = float(np.mean(np.abs(actual - predicted) / np.abs(actual)))
    return {"mae": _finite(_mae(actual, predicted), 2), "mape": _finite(mape, 4), "mae_h": mae_h}


def _quantile_table(rel_by_h: dict, horizon: int) -> dict:
    """{h: {p025..p975: relative offset}}, tails never narrowing with h."""
    table = {}
    for h in range(1, horizon + 1):
        row = {name: float(np.quantile(rel_by_h[h], level)) for name, level in QUANTILES.items()}
        if h > 1:
            prev = table[h - 1]
            for name, level in QUANTILES.items():
                if level < 0.5:
                    row[name] = min(row[name], prev[name])
                elif level > 0.5:
                    row[name] = max(row[name], prev[name])
        table[h] = row
    return table


def _extend_table(table: dict, rel_by_h: dict, horizon: int, max_horizon: int) -> dict:
    """Beyond the backtested horizon: pooled standardized errors scaled by sqrt(h)."""
    pooled = np.concatenate([np.asarray(rel_by_h[h]) / math.sqrt(h) for h in range(1, horizon + 1)])
    pooled_q = {name: float(np.quantile(pooled, level)) for name, level in QUANTILES.items()}
    for h in range(horizon + 1, max_horizon + 1):
        prev = table[h - 1]
        row = {}
        for name, level in QUANTILES.items():
            if level == 0.5:
                row[name] = prev[name]
            elif level < 0.5:
                row[name] = min(pooled_q[name] * math.sqrt(h), prev[name])
            else:
                row[name] = max(pooled_q[name] * math.sqrt(h), prev[name])
        table[h] = row
    return table


def _slug(name: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-").replace("--", "-")


# ----------------------------------------------------------------------------
# Training
# ----------------------------------------------------------------------------
def train(series: pd.Series, source: str = "") -> dict:
    """Backtest the candidates on the monthly BD series and build the artifact."""
    y = np.asarray(series.values, dtype=float)
    folds = _folds(y)
    if len(folds) < 6:
        raise ValueError(f"only {len(folds)} backtest folds (need at least 6)")

    preds = {name: [model_forecast(name, tr, HORIZON) for tr, _ in folds] for name in MODEL_NAMES}
    n_select = len(folds) - HOLDOUT_FOLDS if len(folds) >= HOLDOUT_FOLDS + 4 else len(folds)
    select_folds, hold_folds = folds[:n_select], folds[n_select:]

    leaderboard = {}
    for name in MODEL_NAMES:
        m_all = _metrics(folds, preds[name])
        m_sel = _metrics(select_folds, preds[name][:n_select])
        m_hold = _metrics(hold_folds, preds[name][n_select:]) if hold_folds else None
        leaderboard[name] = {
            "mae": m_all["mae"], "mape": m_all["mape"], "mae_h": m_all["mae_h"],
            "mae_select": m_sel["mae"],
            "mae_holdout": m_hold["mae"] if m_hold else None,
            "mae_h_holdout": m_hold["mae_h"] if m_hold else None,
        }
    champion = min(MODEL_NAMES, key=lambda n: leaderboard[n]["mae_select"])

    # signed relative errors of the champion per horizon: (actual - point) / point
    rel_by_h = {
        h: np.array([(te[h - 1] - pr[h - 1]) / max(pr[h - 1], 1.0) for (_, te), pr in zip(folds, preds[champion])])
        for h in range(1, HORIZON + 1)
    }
    table = _extend_table(_quantile_table(rel_by_h, HORIZON), rel_by_h, HORIZON, MAX_HORIZON)

    coverage = None
    if hold_folds:
        n_cal = len(folds) - len(hold_folds)
        inside = []
        for h in range(1, HORIZON + 1):
            lo = float(np.quantile(rel_by_h[h][:n_cal], QUANTILES["p10"]))
            hi = float(np.quantile(rel_by_h[h][:n_cal], QUANTILES["p90"]))
            inside.append((rel_by_h[h][n_cal:] >= lo) & (rel_by_h[h][n_cal:] <= hi))
        coverage = float(np.concatenate(inside).mean())

    # live forecast from the full series
    path = model_forecast(champion, y, MAX_HORIZON)
    last_period = series.index[-1]
    forecasts = []
    for i in range(MAX_HORIZON):
        h = i + 1
        point = float(path[i])
        raw = {name: point * (1.0 + table[h][name]) for name in QUANTILES}
        ordered = sorted(raw.values())
        values = dict(zip(sorted(QUANTILES, key=lambda k: QUANTILES[k]), ordered))
        forecasts.append({
            "target_month": (last_period + h).end_time.strftime("%Y-%m-%d"),
            "horizon": h,
            "point": round(point, 2),
            "p025": round(values["p025"], 2),
            "p10": round(values["p10"], 2),
            "p50": round(values["p50"], 2),
            "p90": round(values["p90"], 2),
            "p975": round(values["p975"], 2),
            "best_purchase_case": round(values["p10"], 2),
            "base_case": round(values["p50"], 2),
            "worst_purchase_case": round(values["p90"], 2),
        })

    origin = last_period.end_time.strftime("%Y-%m-%d")
    champ = leaderboard[champion]
    artifact = {
        "artifact_version": f"{origin}-{_slug(champion)}-v2",
        "symbol": data.SYMBOL,
        "commodity": data.COMMODITY,
        "market": data.MARKET,
        "unit": data.UNIT,
        "forecast_origin": origin,
        "model_name": champion,
        "validation_mae": champ["mae"],
        "validation_mae_by_horizon": champ["mae_h"],
        "validation_mae_holdout": champ["mae_holdout"],
        "naive_mae": leaderboard[NAIVE]["mae"],
        "readiness": READINESS,
        "scenario_interpretation": SCENARIO_INTERPRETATION,
        "forecasts": forecasts,
        "champion": champion,
        "leaderboard": leaderboard,
        "interval": {
            "basis": "relative signed backtest errors per horizon",
            "levels": list(QUANTILES.values()),
            "coverage_p10_p90_holdout": _finite(coverage, 3),
            "table": {str(h): {k: round(v, 5) for k, v in row.items()} for h, row in table.items()},
        },
        "protocol": {
            "backtest": f"rolling-origin, monthly-stepped, expanding window, {FOLD_MONTHS} folds x horizon {HORIZON}",
            "selection": f"champion by pooled MAE h1-h{HORIZON} on the earlier folds; last {HOLDOUT_FOLDS} folds reported as hold-out",
            "extrapolation": f"quantiles beyond h={HORIZON} use pooled errors scaled by sqrt(h)",
            "max_horizon": MAX_HORIZON,
        },
        "history": [{"period": str(p), "value": round(float(v), 2)} for p, v in series.items()],
        "last_value": round(float(y[-1]), 2),
        "last_month": str(last_period),
        "months": int(len(y)),
        "folds": len(folds),
        "select_folds": n_select,
        "holdout_folds": len(hold_folds),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
    }
    validate_artifact(artifact)
    return artifact


def train_all(bd_file=None) -> dict:
    series = data.load_bd_monthly(bd_file)
    return train(series, source=str(data.find_bd_file(bd_file)))


# ----------------------------------------------------------------------------
# Serving
# ----------------------------------------------------------------------------
def forecast_response(engine: dict, horizon: int) -> dict:
    """The forecast payload the original UI expects, cut to `horizon` rows."""
    horizon = int(max(1, min(MAX_HORIZON, horizon)))
    rows = engine["forecasts"][:horizon]
    return {
        "artifact_version": engine["artifact_version"],
        "symbol": engine["symbol"],
        "commodity": engine["commodity"],
        "market": engine["market"],
        "unit": engine["unit"],
        "forecast_origin": engine["forecast_origin"],
        "model_name": engine["model_name"],
        "validation_mae": engine["validation_mae"],
        "validation_mae_by_horizon": engine.get("validation_mae_by_horizon"),
        "validation_mae_holdout": engine.get("validation_mae_holdout"),
        "naive_mae": engine.get("naive_mae"),
        "coverage_p10_p90_holdout": (engine.get("interval") or {}).get("coverage_p10_p90_holdout"),
        "readiness": engine["readiness"],
        "scenario_interpretation": engine["scenario_interpretation"],
        "horizon_months": len(rows),
        "last_value": engine.get("last_value"),
        "last_month": engine.get("last_month"),
        "engine_source": engine.get("engine_source"),
        "forecasts": rows,
    }


def scenario_path(engine: dict, scenario: str, horizon: int) -> list:
    """BD values for months t+1..t+horizon under a scenario (low=P10, base=P50, high=P90)."""
    if scenario == "flat":
        return []
    key = SCENARIO_QUANTILE.get(scenario)
    if key is None:
        raise ValueError(f"unknown scenario {scenario}; expected one of {SCENARIOS}")
    values = [float(row[key]) for row in engine["forecasts"]][:horizon]
    while len(values) < horizon:
        values.append(values[-1])
    return values


def leaderboard_rows(engine: dict) -> list:
    rows = []
    for name, info in (engine.get("leaderboard") or {}).items():
        rows.append({
            "model": name,
            "champion": name == engine.get("champion"),
            "mae": info.get("mae"),
            "mape": info.get("mape"),
            "mae_select": info.get("mae_select"),
            "mae_holdout": info.get("mae_holdout"),
            "mae_h1": (info.get("mae_h") or {}).get("1"),
            "mae_h2": (info.get("mae_h") or {}).get("2"),
            "mae_h3": (info.get("mae_h") or {}).get("3"),
            "mae_h4": (info.get("mae_h") or {}).get("4"),
        })
    return rows


# ----------------------------------------------------------------------------
# Artifact I/O
# ----------------------------------------------------------------------------
def save_artifact(engine: dict, path=DEFAULT_ARTIFACT_PATH) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {k: v for k, v in engine.items() if k != "engine_source"}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def load_artifact(path) -> dict:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    validate_artifact(payload)
    return payload


def load_or_train(path=DEFAULT_ARTIFACT_PATH, bd_file=None, sample_path=SAMPLE_ARTIFACT_PATH) -> tuple:
    """(engine, source): 'artifact' when the trained file exists, 'trained' after a
    fresh run, 'sample' when no BD data is available and the committed sample is served."""
    path = Path(path)
    if path.exists():
        engine = load_artifact(path)
        engine["engine_source"] = "artifact"
        return engine, "artifact"
    try:
        engine = train_all(bd_file)
    except Exception as exc:
        log.warning("[RawMat] training skipped (%s); serving the sample artifact", exc)
        engine = load_artifact(sample_path)
        engine["engine_source"] = "sample"
        return engine, "sample"
    try:
        save_artifact(engine, path)
    except OSError as exc:
        log.warning("[RawMat] could not write artifact %s: %s", path, exc)
    engine["engine_source"] = "trained"
    return engine, "trained"
