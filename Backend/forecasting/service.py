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
from .models import (
    forecast_croston, forecast_sba, forecast_seasonal_naive, forecast_tsb,
)

log = logging.getLogger("ibp.forecast")

NAIVE_NAME = "SeasonalNaive(m=12)"
HORIZON = 3
FOLD_MONTHS = 16
FOLD_MONTHS_LONG = 4   # folds for the h12 backtest (~48 OOS points per grade)
MAX_HORIZON = 12
INTERVAL_LEVEL_PCT = 80
MIN_TRAIN_MONTHS = 24


def _stepped_folds(series, horizon: int, n_folds: int) -> list:
    """Monthly-stepped expanding-window folds, each with a full horizon test.

    Folds are series slices - month-aware models may use the calendar index.
    """
    n = len(series)
    folds = []
    for k in range(horizon, n_folds + horizon):
        cutoff = n - k
        if cutoff < MIN_TRAIN_MONTHS:
            continue
        folds.append((series.iloc[:cutoff], series.values[cutoff:cutoff + horizon]))
    return folds


def _backtest(series, candidates, horizon, n_folds):
    """One stepped-fold backtest of every candidate at one horizon.

    Returns (folds, evaluations, per_fold_preds, ensemble_fn). The ensemble
    is an inverse-WAPE weighted average of the three strongest candidates,
    scored like any other candidate; None when fewer than two are usable.
    """
    folds = _stepped_folds(series, horizon, n_folds)
    if not folds:
        return [], {}, {}, None
    evaluations = {}
    per_fold_preds = {}
    for name, fn in candidates.items():
        # Fit ONCE per fold - every metric below reuses these predictions
        per_fold_pred = [fn(f[0], horizon) for f in folds]
        per_fold_preds[name] = per_fold_pred
        actual = np.concatenate([f[1] for f in folds])
        predicted = np.concatenate(per_fold_pred)
        scales = [s for s in (_naive12_scale(f[0]) for f in folds) if not np.isnan(s)]
        mase = float("nan")
        if scales:
            mase = float(np.abs(actual - predicted).mean() / np.mean(scales))
        res_h = {
            h: np.array([abs(f[1][h - 1] - p[h - 1])
                         for f, p in zip(folds, per_fold_pred)])
            for h in range(1, horizon + 1)
        }
        wape_h = {
            h: _wape(np.array([f[1][h - 1] for f in folds]),
                     np.array([p[h - 1] for p in per_fold_pred]))
            for h in range(1, horizon + 1)
        }
        evaluations[name] = {
            "wape": _wape(actual, predicted),
            "mase": mase,
            "wape_h": wape_h,
            "res_h": res_h,
            "_actual": actual,
            "_predicted": predicted,
        }

    # Weighted top-3 ensemble, scored like any other candidate. Replaces the
    # old all-member median, whose weak members diluted every forecast month.
    ranked = sorted(
        (n for n, e in evaluations.items() if np.isfinite(e["wape"])),
        key=lambda n: evaluations[n]["wape"],
    )
    top3 = ranked[:3]
    ensemble_fn = None
    if len(top3) >= 2:
        weights = np.array([1.0 / max(evaluations[n]["wape"], 1e-6) for n in top3])
        weights /= weights.sum()
        ens_preds = [
            np.sum([w * per_fold_preds[n][i] for w, n in zip(weights, top3)], axis=0)
            for i in range(len(folds))
        ]
        actual = np.concatenate([f[1] for f in folds])
        predicted = np.concatenate(ens_preds)
        scales = [s for s in (_naive12_scale(f[0]) for f in folds) if not np.isnan(s)]
        mase = float("nan")
        if scales:
            mase = float(np.abs(actual - predicted).mean() / np.mean(scales))
        res_h = {
            h: np.array([abs(f[1][h - 1] - p[h - 1])
                         for f, p in zip(folds, ens_preds)])
            for h in range(1, horizon + 1)
        }
        wape_h = {
            h: _wape(np.array([f[1][h - 1] for f in folds]),
                     np.array([p[h - 1] for p in ens_preds]))
            for h in range(1, horizon + 1)
        }
        evaluations["TOP3-ENS"] = {
            "wape": _wape(actual, predicted),
            "mase": mase,
            "wape_h": wape_h,
            "res_h": res_h,
            "_actual": actual,
            "_predicted": predicted,
        }
        members = {n: candidates[n] for n in top3}

        def ensemble_fn(series_train, h, _members=members, _weights=weights):
            preds = np.array([m(series_train, h) for m in _members.values()], dtype=float)
            return _weights @ preds

    return folds, evaluations, per_fold_preds, ensemble_fn


def _select_champion(evaluations) -> tuple:
    """Best finite-WAPE name after the seasonal benchmark gate (name, info)."""
    eligible = {n: e for n, e in evaluations.items() if np.isfinite(e["wape"])}
    if not eligible:
        raise ValueError("no model produced a finite WAPE on this grade")
    best_name = min(eligible, key=lambda n: eligible[n]["wape"])
    # Fail closed: an unfired or unmeasurable gate (NaN MASE) keeps the benchmark
    if best_name != NAIVE_NAME and not (eligible[best_name]["mase"] < 1.0):
        best_name = NAIVE_NAME
    return best_name, eligible[best_name]


def train_grade(series, extra_candidates=None) -> dict:
    """Backtest every model on one grade and crown TWO champions.

    - short (months 1-3): the 16-fold h3 backtest, what the planner acts on.
    - long (months 4-12): a 4-fold h12 backtest - the far months the group
      plan consumes, where a h3-selected champion is not necessarily best.
    Both pass the same seasonal benchmark gate; the baseline is spliced from
    the two and bands for months 4-12 come from the REAL h12 residuals.
    """
    candidates = dict(MODELS)
    if extra_candidates:
        candidates.update(extra_candidates)

    short_folds, short_evals, _, short_ens = _backtest(series, candidates, HORIZON, FOLD_MONTHS)
    long_folds, long_evals, _, long_ens = _backtest(series, candidates, MAX_HORIZON, FOLD_MONTHS_LONG)

    best_name, short_eval = _select_champion(short_evals)
    try:
        long_name, long_eval = _select_champion(long_evals)
        have_long = bool(long_folds)
    except ValueError:
        long_name, long_eval, have_long = best_name, short_eval, False

    def _band(info, horizon):
        """L% offset per horizon month, monotonically non-shrinking."""
        band = {h: float(np.quantile(info["res_h"][h], INTERVAL_LEVEL_PCT / 100))
                for h in range(1, horizon + 1)}
        for h in range(2, horizon + 1):
            band[h] = max(band[h], band[h - 1])
        return band

    # Symmetric L% band: offset = L-quantile of |residual|, applied to both
    # sides. (Splitting |residual| into q10/q90 for the two sides would cover
    # only ~50% - the classic mistake this block avoids.) Months 1-3 come
    # from the short backtest, months 4-12 from the REAL h12 residuals -
    # the old sqrt(h) guess is gone. The band never shrinks with distance.
    q_band = _band(short_eval, HORIZON)
    if have_long:
        long_band = _band(long_eval, MAX_HORIZON)
        for h in range(HORIZON + 1, MAX_HORIZON + 1):
            q_band[h] = max(long_band[h], q_band[h - 1])

    # standardized residuals (by sqrt(h)) -> pooled band beyond month 12.
    # Pooled from the long residuals when available - they measure the far
    # months this band actually has to cover.
    pool_info = long_eval if have_long else short_eval
    pool_top = MAX_HORIZON if have_long else HORIZON
    std_pool = np.concatenate([
        pool_info["res_h"][h] / np.sqrt(h) for h in range(1, pool_top + 1)
    ])
    std_q = float(np.quantile(std_pool, INTERVAL_LEVEL_PCT / 100))

    # Honest coverage: calibrate the quantile on the earlier folds only and
    # evaluate on the held-out last folds. (In-sample coverage of a residual
    # quantile is pinned near L% by construction and would be tautological.)
    n_cal = max(1, len(short_folds) - 4)
    inside_parts = []
    for h in range(1, HORIZON + 1):
        q_cal = float(np.quantile(short_eval["res_h"][h][:n_cal], INTERVAL_LEVEL_PCT / 100))
        inside_parts.append(np.abs(short_eval["res_h"][h][n_cal:]) <= q_cal)
    coverage = float(np.concatenate(inside_parts).mean())

    short_fn = short_ens if best_name == "TOP3-ENS" else candidates[best_name]
    long_fn = long_ens if long_name == "TOP3-ENS" else candidates[long_name]

    def _baseline_12(s):
        short_part = np.atleast_1d(np.asarray(short_fn(s, HORIZON), dtype=float))[:HORIZON]
        long_part = np.atleast_1d(np.asarray(long_fn(s, MAX_HORIZON), dtype=float))[HORIZON:MAX_HORIZON]
        return np.concatenate([short_part, long_part])

    return {
        "champion": best_name,
        "champion_long": long_name if have_long else best_name,
        "wape": short_eval["wape"],
        "mase": short_eval["mase"],
        "wape_h": short_eval["wape_h"],
        "wape_long": long_eval["wape"] if have_long else None,
        "mase_long": long_eval["mase"] if have_long else None,
        "interval_level_pct": INTERVAL_LEVEL_PCT,
        "coverage_empirical": coverage,
        "q_lo": q_band,
        "q_hi": q_band,
        "std_q_lo": std_q,
        "std_q_hi": std_q,
        "baseline_12": _baseline_12(series),
        "months": len(series),
        "avg_tons": float(series.mean()),
        "trained_through": str(series.index[-1]),
    }


def interval_for(info: dict, h: int) -> tuple:
    """(lower_offset, upper_offset) in tons for horizon h.

    Months 1-3 use the short backtest's quantiles, months 4-12 the REAL
    h12 residuals; only beyond 12 does the pooled sqrt extrapolation remain.
    """
    q = info["q_lo"]
    if h <= MAX_HORIZON and h in q:
        return q[h], info["q_hi"][h]
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


def _bu_material_components(billing, grade, max_components=2):
    """Top-N materials by tonnage within one grade (monthly series each)."""
    g = billing[billing["Grade"] == grade]
    per = g.groupby(["Material Number", "_month"])["QTY(ton)"].sum()
    totals = g.groupby("Material Number")["QTY(ton)"].sum().sort_values(ascending=False)
    comps = {}
    for key, _tons in totals.items():
        if len(comps) >= max_components:
            break
        s = per.get(key)
        if s is None or len(s) < 8:
            continue
        comps[str(key)] = s.reindex(
            pd.period_range(s.index.min(), s.index.max(), freq="M"), fill_value=0.0
        )
    return comps


def _make_bu_material(components):
    """Bottom-up over tracked materials: per-component zoo model (re-selected
    by the component's own backtest at every cutoff - train-only) plus the
    seasonal benchmark on the untracked 'others' residual."""
    from .models import _select_component

    def fn(series_train, h):
        idx = series_train.index
        comp_preds, tracked = [], set()
        for key, s_full in components.items():
            s = s_full[s_full.index <= idx[-1]]
            if len(s) < 8:
                continue
            tracked.add(key)
            _, cfn = _select_component(s, horizon=h, folds=3)
            comp_preds.append(cfn(s, h))
        if not comp_preds:
            return forecast_seasonal_naive(series_train, h)
        bottom_up = np.sum(comp_preds, axis=0)
        others = series_train.astype(float).copy()
        for key in tracked:
            others = others - components[key].reindex(idx, fill_value=0.0)
        return bottom_up + forecast_seasonal_naive(others.clip(lower=0.0), h)

    return fn


def train_all(path=None) -> dict:
    """Train every pilot grade; called at startup and on retrain."""
    billing = data.load_billing_frame(path)
    series_by_grade = data.pilot_series(billing)
    if not series_by_grade:
        raise RuntimeError("no usable demand series in the billing data")
    grades = {}
    for name, series in series_by_grade.items():
        try:
            extra = {}
            try:
                from .candidates import arima_models, sklearn_models, xgb_models
                extra["ARIMA(2,1,2)"] = arima_models.make_fn(arima_models.CONFIGS["ARIMA (2,1,2)"])
                extra["ARIMA(1,1,1)"] = arima_models.make_fn(arima_models.CONFIGS["ARIMA (1,1,1)"])
                extra["XGB-MAE"] = xgb_models.make_fn(xgb_models.CONFIGS["single MAE d3 lr.05 sub.9 col.8"])
                extra["RF-abs-err"] = sklearn_models.make_fn(sklearn_models.CONFIGS["RF direct abs-err d4 leaves=1 sqrt"])
            except Exception as exc:
                log.warning("[Forecast] could not load candidate zoo: %s", exc)

            if name in data.SPARSE_GRADES:
                # campaign grades with many zero months -> intermittent methods
                extra.update({
                    "Croston": forecast_croston,
                    "SBA (bias-corrected)": forecast_sba,
                    "TSB": forecast_tsb,
                })
            else:
                comps = _bu_material_components(billing, name)
                if comps:
                    extra["BU-material(top-2)"] = _make_bu_material(comps)
            grades[name] = train_grade(series, extra)
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
