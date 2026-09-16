"""
Forecasting package for the IBP platform (UBE Chemicals / TSL).

`__init__` keeps the legacy fallback engine exactly as it was in
forecasting.py, so Backend/main.py keeps importing the same names from
the same place. The real demand-forecasting models live in the
submodules (data / models / backtest) and are only imported when the
forecast feature actually runs, so the pure What-if flow never needs
pandas or statsmodels.
"""

import math

# Legacy model identifier reported to the audit trail and the dashboard
MODEL_NAME = "Ensemble Baseline (ETS/ML)"


def go_round(value: float) -> float:
    """Round half away from zero (Go math.Round semantics).

    Python's built-in round() uses banker's rounding, which would drift
    from the legacy Go results on exact .5 values.

    Known 1-ulp limitation: like floor(x+0.5), this rounds 0.49999999999999994
    (the double just below 0.5) up to 1, where Go's math.Round returns 0.
    Unreachable for realistic demand inputs.
    """
    return math.floor(value + 0.5) if value >= 0 else math.ceil(value - 0.5)


def round2(value: float) -> float:
    """Round to 2 decimal places using Go semantics (math.Round(x*100)/100)."""
    return go_round(value * 100.0) / 100.0


def generate_forecast(base_demand: float, demand_change_pct: float) -> tuple:
    """Generate a point forecast with a prediction interval.

    Legacy Ensemble Baseline (ETS/ML) placeholder logic, carried over
    verbatim from the Go direct engine and the original model-service:
    linear uplift on the base demand with a fixed +-5% band.

    One deliberate difference from the old Go service: the offline-fallback
    identifier "Ensemble Baseline (ETS/ML - Direct Engine)" is retired,
    because the forecasting engine now runs in-process and is always
    reachable - the success-path model name below is reported
    unconditionally.

    Returns:
        (forecast, lower_bound, upper_bound, model_name)
    """
    multiplier = 1.0 + (demand_change_pct / 100.0)
    forecast = round2(base_demand * multiplier)
    if forecast < 0:
        forecast = 0.0

    lower = round2(forecast * 0.95)
    upper = round2(forecast * 1.05)

    return forecast, lower, upper, MODEL_NAME
