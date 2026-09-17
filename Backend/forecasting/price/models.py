"""
Candidate models for the monthly selling price of one grade.

- Naive: last realized price. The benchmark every other model must beat.
- ETS damped (no seasonality): univariate exponential smoothing.
- BD pass-through: p_t = a + b1*BD_{t-1} + b2*BD_{t-2} + c*p_{t-1}. Selling
  prices of BR follow butadiene with a one to two month lag (contract
  formulas reference the previous period), so the regression forecasts
  recursively along a BD path the caller supplies.
- Ensemble: mean of pass-through and naive.

All functions return a numpy array of length h and never raise: a fit that
fails falls back to the next simpler model.
"""

from __future__ import annotations

import numpy as np

NAIVE = "Naive(last price)"
ETS = "ETS damped"
PASS_THROUGH = "BD pass-through(lag1-2)"
ENSEMBLE = "Ensemble(pass-through+naive)"
MODEL_NAMES = [NAIVE, ETS, PASS_THROUGH, ENSEMBLE]

MIN_ETS_MONTHS = 12


def forecast_naive(y, h: int) -> np.ndarray:
    values = np.asarray(y, dtype=float)
    return np.repeat(values[-1], h)


def forecast_ets(y, h: int) -> np.ndarray:
    """Damped additive-trend exponential smoothing; naive when too short or on failure."""
    values = np.asarray(y, dtype=float)
    if len(values) < MIN_ETS_MONTHS:
        return forecast_naive(values, h)
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        fitted = ExponentialSmoothing(
            values, trend="add", damped_trend=True, initialization_method="estimated"
        ).fit(optimized=True)
        return np.maximum(np.asarray(fitted.forecast(h), dtype=float), 0.0)
    except Exception:
        return forecast_naive(values, h)


def fit_passthrough(frame) -> np.ndarray:
    """Least-squares coefficients [a, b1, b2, c] for p ~ 1 + bd1 + bd2 + p1."""
    X = np.column_stack([
        np.ones(len(frame)),
        frame["bd1"].to_numpy(dtype=float),
        frame["bd2"].to_numpy(dtype=float),
        frame["p1"].to_numpy(dtype=float),
    ])
    y = frame["p"].to_numpy(dtype=float)
    gram = X.T @ X
    ridge = 1e-6 * np.trace(gram) / X.shape[1]  # numerical stability only
    return np.linalg.solve(gram + ridge * np.eye(X.shape[1]), X.T @ y)


def forecast_passthrough(coef, last_price: float, bd_last: float, bd_prev: float, bd_future, h: int) -> np.ndarray:
    """Recursive pass-through forecast for months t+1..t+h.

    bd_last  = BD of the last history month t (known)
    bd_prev  = BD of month t-1 (known)
    bd_future = BD assumed for t+1, t+2, ... (only the first h-1 values matter)
    """
    coef = np.asarray(coef, dtype=float)
    bd_future = np.asarray(bd_future, dtype=float)
    out = []
    p_prev, lag1, lag2 = float(last_price), float(bd_last), float(bd_prev)
    for i in range(h):
        p = coef[0] + coef[1] * lag1 + coef[2] * lag2 + coef[3] * p_prev
        p = max(p, 0.0)
        out.append(p)
        lag2 = lag1
        lag1 = float(bd_future[i]) if i < len(bd_future) else lag1
        p_prev = p
    return np.array(out)


def model_forecast(name: str, frame, h: int, bd_future) -> np.ndarray:
    """Forecast h months ahead from an aligned frame (columns p, bd0, bd1, bd2, p1)."""
    y = frame["p"].to_numpy(dtype=float)
    if name == NAIVE:
        return forecast_naive(y, h)
    if name == ETS:
        return forecast_ets(y, h)
    coef = fit_passthrough(frame)
    passthrough = forecast_passthrough(
        coef, y[-1], frame["bd0"].to_numpy(dtype=float)[-1], frame["bd1"].to_numpy(dtype=float)[-1], bd_future, h
    )
    if name == PASS_THROUGH:
        return passthrough
    if name == ENSEMBLE:
        return (passthrough + forecast_naive(y, h)) / 2.0
    raise ValueError(f"unknown model {name}")
