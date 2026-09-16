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


def forecast_seasonal_naive(train, h: int) -> np.ndarray:
    """Repeat the last 12 observed months (the seasonal benchmark)."""
    values = np.asarray(train, dtype=float)
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

    values = np.asarray(train, dtype=float)
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
