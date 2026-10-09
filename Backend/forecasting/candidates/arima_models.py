"""
Plain non-seasonal ARIMA candidate family (statsmodels ARIMA class).

The seasonal SARIMA variants already live in forecasting.experiments;
this family asks whether a plain integrated ARMA(p, q) model adds
anything for monthly industrial tonnage.

Honesty contract of this harness:
- Tuning uses ONLY the train split (series.index <= TRAIN_END, i.e.
  2019-04..2025-12) via forecasting.experiments._inner_cv.
- The 2026 holdout months are never read, indexed or printed here.

Orchestrator contract:
- CANDIDATE_NAME: family label.
- CONFIGS: the best 2-3 orders kept after inner-CV tuning over the full
  ORDER_GRID below (params dict -> make_fn).
- make_fn(params): returns fn(series_train, h) -> np.ndarray of h
  non-negative predictions. Deterministic (ARIMA MLE has no random
  component); falls back to a seasonal-naive answer on any failure.
"""

import warnings

import numpy as np
import pandas as pd

CANDIDATE_NAME = "ARIMA (non-seasonal)"

MIN_TRAIN = 24

# Full tuning grid: all 6 orders are evaluated by inner CV; the best
# 2-3 by mean inner WAPE across the 4 pilot grades become CONFIGS.
ORDER_GRID = {
    "ARIMA (5,1,2) classic": (5, 1, 2),
    "ARIMA (2,1,2)": (2, 1, 2),
    "ARIMA (1,1,1)": (1, 1, 1),
    "ARIMA (3,1,1)": (3, 1, 1),
    "ARIMA (4,1,2)": (4, 1, 2),
    "ARIMA (0,1,1)": (0, 1, 1),
}


def _seasonal_naive_fallback(values: np.ndarray, h: int) -> np.ndarray:
    """Repeat the last 12 observed months (matches the harness baseline)."""
    if len(values) >= 12:
        reps = int(np.ceil(h / 12.0))
        return np.tile(values[-12:], reps)[:h]
    mean = float(values.mean()) if len(values) else 0.0
    return np.full(h, max(mean, 0.0))


def make_fn(params: dict):
    """Build a forecasting callable for one ARIMA order.

    params: {"order": (p, d, q)} -- a list [p, d, q] is accepted too.
    """
    order = tuple(int(k) for k in params["order"])

    def fn(series_train: pd.Series, h: int) -> np.ndarray:
        from statsmodels.tsa.arima.model import ARIMA

        v = series_train.values.astype(float)
        if len(v) < MIN_TRAIN:
            return _seasonal_naive_fallback(v, h)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                fitted = ARIMA(
                    v,
                    order=order,
                    enforce_stationarity=False,
                    enforce_invertibility=False,
                ).fit(method="statespace", method_kwargs={"maxiter": 200})
                fc = np.asarray(fitted.forecast(h), dtype=float)
            return np.maximum(np.nan_to_num(fc, nan=0.0), 0.0)
        except Exception:
            return _seasonal_naive_fallback(v, h)

    return fn


# Winners of the full ORDER_GRID tuning (mean inner-CV WAPE over the 4
# pilot grades, train period 2019-04..2025-12 only):
#   (2,1,2) 0.1951 | (1,1,1) 0.1966 | (3,1,1) 0.2018
#   vs (5,1,2) 0.2056, (0,1,1) 0.2070, (4,1,2) 0.2144.
# Per-grade winners differ: (2,1,2) best on BR150/BR150L/VCR412,
# (1,1,1) best on VCR617 -- hence the top-3 all kept.
CONFIGS = {
    "ARIMA (2,1,2)": {"order": (2, 1, 2)},
    "ARIMA (1,1,1)": {"order": (1, 1, 1)},
    "ARIMA (3,1,1)": {"order": (3, 1, 1)},
}
