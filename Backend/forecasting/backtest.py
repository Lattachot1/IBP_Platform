"""
Rolling-origin backtest for the demand models.

Protocol (honest by construction):
- Expanding window: each fold trains on everything up to its cutoff and
  is scored on the next `horizon` months it has never seen.
- 6 folds x horizon 3 = 18 out-of-sample points per series.
- WAPE = sum|y - yhat| / sum|y| (primary metric, scale-free).
- MASE scaled by the in-sample SeasonalNaive-12 MAE of the same fold's
  train window; MASE < 1.0 means the model beat the seasonal benchmark.
- No random splits anywhere: time series leakage is the classic way to
  fake accuracy.

Run:  cd Backend && python -m forecasting.backtest
"""

import numpy as np

from . import data
from .models import forecast_ets, forecast_seasonal_naive

MODELS = {
    "SeasonalNaive(m=12)": forecast_seasonal_naive,
    "Holt-Winters(ETS damped)": forecast_ets,
}
MIN_TRAIN_MONTHS = 24


def _wape(actual: np.ndarray, predicted: np.ndarray) -> float:
    denom = np.abs(actual).sum()
    if denom == 0:
        return float("nan")
    return float(np.abs(actual - predicted).sum() / denom)


def _naive12_scale(train: np.ndarray) -> float:
    """In-sample SeasonalNaive-12 one-step MAE on the train window."""
    values = np.asarray(train, dtype=float)
    m = 12
    if len(values) <= m:
        return float("nan")
    return float(np.abs(values[m:] - values[:-m]).mean())


def rolling_backtest(series, horizon: int = 3, n_folds: int = 6) -> dict:
    """Return {model_name: [(train, actual, predicted) per fold]}."""
    y = np.asarray(series, dtype=float)
    n = len(y)
    out = {name: [] for name in MODELS}
    for k in range(n_folds, 0, -1):
        cutoff = n - k * horizon
        if cutoff < MIN_TRAIN_MONTHS:
            continue
        train, actual = y[:cutoff], y[cutoff:cutoff + horizon]
        for name, fn in MODELS.items():
            out[name].append((train, actual, fn(train, horizon)))
    return out


def summarize_series(series, horizon: int = 3, n_folds: int = 6) -> list:
    """Per-model summary rows: WAPE, MASE and per-horizon WAPE."""
    folds_by_model = rolling_backtest(series, horizon, n_folds)
    rows = []
    for name, folds in folds_by_model.items():
        if not folds:
            continue
        actual = np.concatenate([f[1] for f in folds])
        predicted = np.concatenate([f[2] for f in folds])
        scales = [_naive12_scale(f[0]) for f in folds]
        scales = [s for s in scales if not np.isnan(s)]
        mase = float("nan")
        if scales:
            mase = float(np.abs(actual - predicted).mean() / np.mean(scales))
        row = {"model": name, "wape": _wape(actual, predicted), "mase": mase}
        for i in range(horizon):
            a = np.array([f[1][i] for f in folds])
            p = np.array([f[2][i] for f in folds])
            row[f"wape_h{i + 1}"] = _wape(a, p)
        rows.append(row)
    return rows


def main() -> None:
    series_by_grade = data.pilot_series()
    horizon, n_folds = 3, 6
    print(f"Rolling-origin backtest: {n_folds} folds x horizon {horizon} "
          f"(billing-month tonnage, current month excluded)\n")
    for grade, series in series_by_grade.items():
        print(f"=== {grade}  ({len(series)} months: {series.index[0]}..{series.index[-1]}, "
              f"avg {series.mean():,.0f} t/mo) ===")
        rows = summarize_series(series, horizon, n_folds)
        header = f"{'model':<28}{'WAPE':>8}{'MASE':>8}{'WAPE h1':>9}{'h2':>8}{'h3':>8}"
        print(header)
        for row in rows:
            print(f"{row['model']:<28}{row['wape']:>8.1%}{row['mase']:>8.2f}"
                  f"{row['wape_h1']:>9.1%}{row['wape_h2']:>8.1%}{row['wape_h3']:>8.1%}")
        best = min(rows, key=lambda r: r["wape"])
        beats_naive = best["mase"] < 1.0
        print(f"-> winner: {best['model']} "
              f"({'MASE<1: beats seasonal naive' if beats_naive else 'WARNING: does NOT beat naive'})\n")


if __name__ == "__main__":
    main()
