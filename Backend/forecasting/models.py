"""
Forecast models for monthly demand series (tonnage).

Ladder of sophistication, in the order they should be trusted:
1. SeasonalNaive(m=12) - the benchmark every other model must beat.
2. Holt-Winters (damped-trend ETS) - the first real model; robust on
   ~90 monthly observations.
No deep learning, no pretrained internet models: the series are short,
the models above are the industry standard at this size, and everything
trains on a laptop in under a second.
"""

import numpy as np
import pandas as pd


def _wape(actual, predicted) -> float:
    """Weighted absolute percentage error (the headline metric)."""
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    denom = np.abs(actual).sum()
    if denom == 0:
        return float("nan")
    return float(np.abs(actual - predicted).sum() / denom)


def _series_values(train):
    """Accept a pd.Series (month-aware models need the index) or ndarray."""
    if hasattr(train, "values"):
        return train.values.astype(float)
    return np.asarray(train, dtype=float)


def forecast_seasonal_naive(train, h: int) -> np.ndarray:
    """Repeat the last 12 observed months (the seasonal benchmark)."""
    values = _series_values(train)
    m = 12
    if len(values) < m:
        mean = values.mean() if len(values) else 0.0
        return np.full(h, mean)
    reps = int(np.ceil(h / m))
    return np.tile(values[-m:], reps)[:h]


def forecast_ets(train, h: int) -> np.ndarray:
    """Holt-Winters exponential smoothing with damped additive trend.

    Falls back to SeasonalNaive when the series is too short or the fit
    fails to converge - a forecast must always come back.
    """
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    values = _series_values(train)
    if len(values) < 24:
        return forecast_seasonal_naive(train, h)
    try:
        model = ExponentialSmoothing(
            values,
            trend="add",
            damped_trend=True,
            seasonal="add",
            seasonal_periods=12,
            initialization_method="estimated",
        )
        fitted = model.fit(optimized=True)
        forecast = np.asarray(fitted.forecast(h), dtype=float)
        return np.maximum(forecast, 0.0)
    except Exception:
        return forecast_seasonal_naive(train, h)


def forecast_sarima(train, h: int) -> np.ndarray:
    """SARIMA (1,0,1)x(1,1,1,12): captures month-to-month autocorrelation
    (e.g. a shock month followed by a rebound) that ETS has no mechanism for.

    Slower to fit than ETS and needs its order chosen; same fallback rule
    as everything else - if it cannot fit, SeasonalNaive answers instead.
    """
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    values = _series_values(train)
    if len(values) < 24:
        return forecast_seasonal_naive(train, h)
    try:
        model = SARIMAX(
            values,
            order=(1, 0, 1),
            seasonal_order=(1, 1, 1, 12),
            enforce_stationarity=False,
            enforce_invertibility=False,
        )
        fitted = model.fit(disp=False, maxiter=200)
        forecast = np.asarray(fitted.forecast(h), dtype=float)
        return np.maximum(np.nan_to_num(forecast, nan=0.0), 0.0)
    except Exception:
        return forecast_seasonal_naive(train, h)


def _gb_row(v_hist, month):
    """Calendar/lag feature row for one forecast origin."""
    ang = 2 * np.pi * (month - 1) / 12
    return [
        v_hist[-1], v_hist[-2], v_hist[-3], v_hist[-12],
        v_hist[-3:].mean(), v_hist[-6:].mean(), v_hist[-12:].mean(),
        np.sin(ang), np.cos(ang), month / 12.0,
    ]


def forecast_gbr_median(series, h: int) -> np.ndarray:
    """Gradient boosting (absolute_error loss) on lag/rolling/calendar
    features. absolute_error predicts the conditional MEDIAN, which is
    exactly what WAPE measures - this candidate optimizes the reported
    metric directly. Requires a pd.Series with a monthly PeriodIndex.
    """
    from sklearn.ensemble import HistGradientBoostingRegressor

    months = series.index.month.to_numpy()
    v = series.values.astype(float)
    if len(v) < 24:
        return forecast_seasonal_naive(series, h)

    X, y = [], []
    for t in range(12, len(v)):
        X.append(_gb_row(v[:t], int(months[t])))
        y.append(v[t])
    model = HistGradientBoostingRegressor(
        max_iter=400, learning_rate=0.05, max_leaf_nodes=31,
        loss="absolute_error", random_state=0,
    )
    model.fit(np.array(X), np.array(y))

    hist = list(v)
    mon = int(months[-1])
    preds = []
    for _ in range(h):
        mon = mon % 12 + 1
        feats = np.array(_gb_row(np.array(hist), mon)).reshape(1, -1)
        yhat = max(0.0, float(model.predict(feats)[0]))
        preds.append(yhat)
        hist.append(yhat)
    return np.array(preds)


# ---------------------------------------------------------------------------
# Component zoo for bottom-up forecasting: tiny instant models applied to
# sparse customer/material series; the best member per series is chosen by
# the series' own backtest (train-only). Research origin: docs/model-comparison.md
# ---------------------------------------------------------------------------
def _c_sn12(s, h):
    v = s.values.astype(float)
    if len(v) >= 12:
        reps = int(np.ceil(h / 12))
        return np.tile(v[-12:], reps)[:h]
    return np.full(h, v[-1] if len(v) else 0.0)


def _c_mean(s, h, window):
    v = s.values.astype(float)
    return np.full(h, v[-window:].mean() if len(v) else 0.0)


def _c_ewm(s, h):
    v = s.values.astype(float)
    return np.full(h, pd.Series(v).ewm(alpha=0.3).mean().iloc[-1])


COMPONENT_ZOO = {
    "sn12": _c_sn12,
    "mean6": lambda s, h: _c_mean(s, h, 6),
    "mean12": lambda s, h: _c_mean(s, h, 12),
    "ewm": _c_ewm,
}


def _select_component(series, horizon=8, folds=3):
    """Pick the zoo member with the best backtest ON THIS component's own
    history (all within the training period - no holdout contact)."""
    n = len(series)
    best_name, best_fn, best_w = "mean6", COMPONENT_ZOO["mean6"], float("inf")
    for name, fn in COMPONENT_ZOO.items():
        scores = []
        for k in range(folds, 0, -1):
            cutoff = n - k * horizon
            if cutoff < 3:
                continue
            actual = series.values[cutoff:cutoff + horizon]
            pred = fn(series.iloc[:cutoff], horizon)
            scores.append(_wape(actual, pred))
        w = float(np.nanmean(scores)) if scores else float("inf")
        if w < best_w:
            best_name, best_fn, best_w = name, fn, w
    return best_name, best_fn


# ---------------------------------------------------------------------------
# Intermittent-demand methods: for grades produced as occasional campaigns
# (UBEPOL BR150B, UBEPOL BR360B) where many months are zero.
# ---------------------------------------------------------------------------
def _croston_sba_rate(v: np.ndarray, alpha: float = 0.2, sba: bool = True) -> float:
    """Croston's method: smooth demand SIZE and inter-demand INTERVAL
    separately, only updating on months with demand. SBA applies the
    Syntetos-Boylan bias correction (1 - a/2). Returns tons/month."""
    idx = [i for i, x in enumerate(v) if x > 0]
    if not idx:
        return 0.0
    z = float(v[idx[0]])   # demand size estimate
    last = idx[0]
    p = 1.0                # inter-demand interval estimate
    for i in idx[1:]:
        z += alpha * (v[i] - z)
        p += alpha * ((i - last) - p)
        last = i
    rate = z / p if p > 0 else z
    if sba:
        rate *= (1 - alpha / 2.0)
    return max(rate, 0.0)


def forecast_croston(series, h: int) -> np.ndarray:
    """Croston's method (1972) - the classic intermittent-demand forecaster."""
    v = _series_values(series)
    return np.full(h, _croston_sba_rate(v, sba=False))


def forecast_sba(series, h: int) -> np.ndarray:
    """Syntetos-Boylan Approximation - the corrected standard for intermittent
    demand; recommended whenever the demand size and interval are correlated."""
    v = _series_values(series)
    return np.full(h, _croston_sba_rate(v, sba=True))


def forecast_tsb(series, h: int) -> np.ndarray:
    """TSB (Teunter-Syntetos-Babai): tracks demand PROBABILITY and demand
    SIZE separately, updating on zero months too - handles the risk of the
    product going inactive entirely."""
    v = _series_values(series)
    if len(v) == 0:
        return np.zeros(h)
    a, d = 0.2, 0.2
    positive = v[v > 0]
    prob = 0.5 if len(positive) else 0.0
    size = float(positive.mean()) if len(positive) else 0.0
    for x in v:
        occ = 1.0 if x > 0 else 0.0
        prob += a * (occ - prob)
        if occ:
            size += d * (x - size)
    return np.full(h, max(prob * size, 0.0))
