"""
Forecast service: turns the billing data into per-grade champion models
with honest, horizon-aware prediction intervals.

Design notes:
- Champion selection per grade from a monthly-stepped backtest (16 folds,
  horizon 3 -> 48 out-of-sample points per model). Gate: if the best-WAPE
  model does not beat the seasonal benchmark (MASE >= 1.0), the benchmark
  stays champion. On real data one grade (BR150L) honestly stays naive.
- Intervals: per-horizon quantiles of |residual| from the same folds
  (80% band). For horizons beyond the fold horizon, residuals are
  standardized by sqrt(h) before pooling, so widths still grow with
  distance. Empirical coverage is reported next to the nominal level.
- The live model is fit once on the full series and cached for horizons
  1..12; API calls only look up results, they never fit.
"""

import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import data
from .backtest import MODELS, _naive12_scale, _wape

log = logging.getLogger("ibp.forecast")

NAIVE_NAME = "SeasonalNaive(m=12)"
HORIZON = 3
FOLD_MONTHS = 16
MAX_HORIZON = 12
INTERVAL_LEVEL_PCT = 80
MIN_TRAIN_MONTHS = 24


def _stepped_folds(y: np.ndarray, horizon: int, n_folds: int) -> list:
    """Monthly-stepped expanding-window folds, each with a full horizon test."""
    n = len(y)
    folds = []
    for k in range(horizon, n_folds + horizon):
        cutoff = n - k
        if cutoff < MIN_TRAIN_MONTHS:
            continue
        folds.append((y[:cutoff], y[cutoff:cutoff + horizon]))
    return folds


def train_grade(series) -> dict:
    """Backtest every model on one grade and crown a champion."""
    y = np.asarray(series.values, dtype=float)
    folds = _stepped_folds(y, HORIZON, FOLD_MONTHS)
    evaluations = {}
    for name, fn in MODELS.items():
        # Fit ONCE per fold - every metric below reuses these predictions
        per_fold_pred = [fn(f[0], HORIZON) for f in folds]
        actual = np.concatenate([f[1] for f in folds])
        predicted = np.concatenate(per_fold_pred)
        scales = [s for s in (_naive12_scale(f[0]) for f in folds) if not np.isnan(s)]
        mase = float("nan")
        if scales:
            mase = float(np.abs(actual - predicted).mean() / np.mean(scales))
        abs_res = np.abs(actual - predicted)
        res_h = {
            h: np.array([abs(f[1][h - 1] - p[h - 1])
                         for f, p in zip(folds, per_fold_pred)])
            for h in range(1, HORIZON + 1)
        }
        wape_h = {
            h: _wape(np.array([f[1][h - 1] for f in folds]),
                     np.array([p[h - 1] for p in per_fold_pred]))
            for h in range(1, HORIZON + 1)
        }
        evaluations[name] = {
            "wape": _wape(actual, predicted),
            "mase": mase,
            "wape_h": wape_h,
            "res_h": res_h,
            "_actual": actual,
            "_predicted": predicted,
        }

    eligible = {n: e for n, e in evaluations.items() if np.isfinite(e["wape"])}
    if not eligible:
        raise ValueError("no model produced a finite WAPE on this grade")
    best_name = min(eligible, key=lambda n: eligible[n]["wape"])
    # Fail closed: an unfired or unmeasurable gate (NaN MASE) keeps the benchmark
    if best_name != NAIVE_NAME and not (eligible[best_name]["mase"] < 1.0):
        best_name = NAIVE_NAME
    champion = evaluations[best_name]

    # Symmetric L% band: offset = L-quantile of |residual|, applied to both
    # sides. (Splitting |residual| into q10/q90 for the two sides would cover
    # only ~50% - the classic mistake this block avoids.)
    q_band = {h: float(np.quantile(champion["res_h"][h], INTERVAL_LEVEL_PCT / 100))
              for h in range(1, HORIZON + 1)}
    # Running max: the band must never shrink with distance (empirical
    # per-horizon quantiles can dip slightly between adjacent horizons).
    for h in range(2, HORIZON + 1):
        q_band[h] = max(q_band[h], q_band[h - 1])

    # standardized residuals (by sqrt(h)) -> pooled band for h > 3.
    # Conservative approximation: sqrt growth can overshoot the measured
    # h2/h3 growth (seasonal-naive-style errors are roughly flat in h).
    std_pool = np.concatenate([
        champion["res_h"][h] / np.sqrt(h) for h in range(1, HORIZON + 1)
    ])
    std_q = float(np.quantile(std_pool, INTERVAL_LEVEL_PCT / 100))

    # Honest coverage: calibrate the quantile on the earlier folds only and
    # evaluate on the held-out last folds. (In-sample coverage of a residual
    # quantile is pinned near L% by construction and would be tautological.)
    n_cal = max(1, len(folds) - 4)
    inside_parts = []
    for h in range(1, HORIZON + 1):
        q_cal = float(np.quantile(champion["res_h"][h][:n_cal], INTERVAL_LEVEL_PCT / 100))
        inside_parts.append(np.abs(champion["res_h"][h][n_cal:]) <= q_cal)
    coverage = float(np.concatenate(inside_parts).mean())

    return {
        "champion": best_name,
        "wape": champion["wape"],
        "mase": champion["mase"],
        "wape_h": champion["wape_h"],
        "interval_level_pct": INTERVAL_LEVEL_PCT,
        "coverage_empirical": coverage,
        "q_lo": q_band,
        "q_hi": q_band,
        "std_q_lo": std_q,
        "std_q_hi": std_q,
        "baseline_12": MODELS[best_name](y, MAX_HORIZON),
        "months": len(y),
        "avg_tons": float(y.mean()),
        "trained_through": str(series.index[-1]),
    }


def interval_for(info: dict, h: int) -> tuple:
    """(lower_offset, upper_offset) in tons for horizon h."""
    if h <= HORIZON:
        return info["q_lo"][h], info["q_hi"][h]
    return info["std_q_lo"] * np.sqrt(h), info["std_q_hi"] * np.sqrt(h)


def forecast(info: dict, horizon: int, demand_change_pct: float = 0.0) -> dict:
    """Compose a forecast from the cached champion (lookup only, no fitting).

    Each forecast month i gets the band of its own horizon (i+1), so the
    interval never shrinks with distance. Beyond the backtested horizon the
    band uses a conservative sqrt(h) extrapolation, and the band scales
    with the scenario uplift (multiplicative-error assumption). Demand is
    clamped at zero like the legacy engine.
    """
    baseline = np.asarray(info["baseline_12"][:horizon], dtype=float)
    multiplier = 1.0 + (demand_change_pct / 100.0)
    scenario = np.maximum(baseline * multiplier, 0.0)
    # Band width follows |uplift| - a negative multiplier must not flip the band
    scale = abs(multiplier)
    lo_offsets = np.array([interval_for(info, i + 1)[0] for i in range(horizon)])
    hi_offsets = np.array([interval_for(info, i + 1)[1] for i in range(horizon)])
    lower = np.maximum(scenario - lo_offsets * scale, 0.0)
    upper = np.maximum(scenario + hi_offsets * scale, 0.0)
    last = pd.Period(info["trained_through"], freq="M")
    return {
        "periods": [str(last + i) for i in range(1, horizon + 1)],
        "baseline_tons": baseline,
        "forecast_tons": scenario,
        "lower_tons": lower,
        "upper_tons": upper,
    }


def train_all(path=None) -> dict:
    """Train every pilot grade; called at startup and on retrain."""
    series_by_grade = data.pilot_series(data.load_billing_frame(path))
    if not series_by_grade:
        raise RuntimeError("no usable demand series in the billing data")
    grades = {}
    for name, series in series_by_grade.items():
        try:
            grades[name] = train_grade(series)
        except Exception as exc:
            log.warning("[Forecast] skipping grade %s: %s", name, exc)
    if not grades:
        raise RuntimeError("every grade failed to train")
    return {
        "grades": grades,
        "series": series_by_grade,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "source_file": str(data.find_source_file(path)),
    }
