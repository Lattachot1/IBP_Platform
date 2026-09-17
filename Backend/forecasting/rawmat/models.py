"""
Candidate models for the monthly butadiene price.

BD behaves close to a random walk, so the random walk is the benchmark and
the other candidates only try to add the one structure the data shows:
slow mean reversion. On the 2021-2026 history the original AutoETS12 pick
collapsed to ETS(M,N,N) with alpha = 1, i.e. the random walk; the mean
reversion candidate was the only one that beat it at horizons 2-4.

Every function returns a numpy array of length h and never raises.
"""

from __future__ import annotations

import numpy as np

NAIVE = "Random walk (last month)"
DRIFT = "Random walk with drift"
ETS_LOG = "ETS damped (log)"
MEAN_REVERSION = "Mean reversion (24m, 15%/mo)"
ETS_SEASONAL = "ETS damped + seasonal(12)"
MODEL_NAMES = [NAIVE, DRIFT, ETS_LOG, MEAN_REVERSION, ETS_SEASONAL]

MEAN_REVERSION_WINDOW = 24
MEAN_REVERSION_PULL = 0.15


def forecast_naive(y, h: int) -> np.ndarray:
    values = np.asarray(y, dtype=float)
    return np.repeat(values[-1], h)


def forecast_drift(y, h: int) -> np.ndarray:
    values = np.asarray(y, dtype=float)
    if len(values) < 2:
        return forecast_naive(values, h)
    slope = (values[-1] - values[0]) / (len(values) - 1)
    return np.maximum(values[-1] + slope * np.arange(1, h + 1), 0.0)


def forecast_ets_log(y, h: int) -> np.ndarray:
    """Damped-trend exponential smoothing on log price; random walk on failure."""
    values = np.asarray(y, dtype=float)
    if len(values) < 12 or (values <= 0).any():
        return forecast_naive(values, h)
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        fitted = ExponentialSmoothing(
            np.log(values), trend="add", damped_trend=True, initialization_method="estimated"
        ).fit(optimized=True)
        return np.exp(np.asarray(fitted.forecast(h), dtype=float))
    except Exception:
        return forecast_naive(values, h)


def forecast_mean_reversion(y, h: int, window: int = MEAN_REVERSION_WINDOW, pull: float = MEAN_REVERSION_PULL) -> np.ndarray:
    """Random walk pulled toward the trailing mean by `pull` of the gap each month."""
    values = np.asarray(y, dtype=float)
    anchor = values[-window:].mean()
    level = values[-1]
    out = []
    for _ in range(h):
        level = level + pull * (anchor - level)
        out.append(level)
    return np.maximum(np.array(out), 0.0)


def forecast_ets_seasonal(y, h: int) -> np.ndarray:
    """Damped additive trend + additive yearly seasonality; random walk when too short."""
    values = np.asarray(y, dtype=float)
    if len(values) < 24:
        return forecast_naive(values, h)
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        fitted = ExponentialSmoothing(
            values, trend="add", damped_trend=True, seasonal="add", seasonal_periods=12,
            initialization_method="estimated",
        ).fit(optimized=True)
        return np.maximum(np.asarray(fitted.forecast(h), dtype=float), 0.0)
    except Exception:
        return forecast_naive(values, h)


def model_forecast(name: str, y, h: int) -> np.ndarray:
    if name == NAIVE:
        return forecast_naive(y, h)
    if name == DRIFT:
        return forecast_drift(y, h)
    if name == ETS_LOG:
        return forecast_ets_log(y, h)
    if name == MEAN_REVERSION:
        return forecast_mean_reversion(y, h)
    if name == ETS_SEASONAL:
        return forecast_ets_seasonal(y, h)
    raise ValueError(f"unknown model {name}")
