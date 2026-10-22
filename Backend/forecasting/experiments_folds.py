"""
Fold-protocol sweep: does changing fold COUNT or fold SIZE help?

Separates two things that are often confused:
1. READING shift - the same model scores differently under different fold
   protocols, because each protocol measures on different test windows.
   This is a change of ruler, not a change of skill.
2. SELECTION shift - a protocol may crown a different champion. The only
   real accuracy that could change is that champion's performance on the
   FIXED 2026 holdout.

For every protocol we therefore report: the champion it crowns, its inner
CV WAPE (the reading), and its holdout WAPE on 2026 (the reality).

Run:  cd Backend && python -m forecasting.experiments_folds
"""

import time

import numpy as np

import pandas as pd

from . import data
from .backtest import _wape, _naive12_scale
from .service import _bu_material_components, _make_bu_material
from .models import (
    forecast_croston, forecast_seasonal_naive, forecast_sba, forecast_tsb,
)

MIN_TRAIN = 24
TRAIN_END = pd.Period("2025-12", freq="M")


def _split(series):
    train = series[series.index <= TRAIN_END]
    test = series[series.index > TRAIN_END]
    return train, test


def naive_fn(series_train, h):
    return forecast_seasonal_naive(series_train, h)


def make_ets(trend, damped, seasonal):
    def fn(series_train, h):
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        v = np.asarray(series_train.values, dtype=float)
        if len(v) < MIN_TRAIN:
            return naive_fn(series_train, h)
        try:
            fitted = ExponentialSmoothing(
                v, trend=trend, damped_trend=damped, seasonal=seasonal,
                seasonal_periods=12, initialization_method="estimated",
            ).fit(optimized=True)
            return np.maximum(np.asarray(fitted.forecast(h), dtype=float), 0.0)
        except Exception:
            return naive_fn(series_train, h)
    return fn


def make_sarima(order, seasonal_order):
    def fn(series_train, h):
        from statsmodels.tsa.statespace.sarimax import SARIMAX
        v = np.asarray(series_train.values, dtype=float)
        if len(v) < MIN_TRAIN:
            return naive_fn(series_train, h)
        try:
            fitted = SARIMAX(
                v, order=order, seasonal_order=seasonal_order,
                enforce_stationarity=False, enforce_invertibility=False,
            ).fit(disp=False, maxiter=200)
            fc = np.asarray(fitted.forecast(h), dtype=float)
            return np.maximum(np.nan_to_num(fc, nan=0.0), 0.0)
        except Exception:
            return naive_fn(series_train, h)
    return fn


def make_gbr(max_iter, learning_rate, max_leaf_nodes, loss="absolute_error"):
    """Recursive GBR on lag/rolling/calendar features (median loss)."""
    def fn(series_train, h):
        from sklearn.ensemble import HistGradientBoostingRegressor
        months = series_train.index.month.to_numpy()
        v = series_train.values.astype(float)
        if len(v) < MIN_TRAIN:
            return naive_fn(series_train, h)
        X, y = [], []
        for t in range(12, len(v)):
            m = int(months[t])
            ang = 2 * np.pi * (m - 1) / 12
            X.append([v[t - 1], v[t - 2], v[t - 3], v[t - 12],
                      v[t - 3:t].mean(), v[t - 6:t].mean(), v[t - 12:t].mean(),
                      np.sin(ang), np.cos(ang), m / 12.0])
            y.append(v[t])
        model = HistGradientBoostingRegressor(
            max_iter=max_iter, learning_rate=learning_rate,
            max_leaf_nodes=max_leaf_nodes, loss=loss, random_state=0,
        )
        model.fit(np.array(X), np.array(y))

        hist = list(v)
        mon = int(months[-1])
        preds = []
        for _ in range(h):
            mon = mon % 12 + 1
            ang = 2 * np.pi * (mon - 1) / 12
            feats = np.array([hist[-1], hist[-2], hist[-3], hist[-12],
                              np.mean(hist[-3:]), np.mean(hist[-6:]),
                              np.mean(hist[-12:]),
                              np.sin(ang), np.cos(ang), mon / 12.0]).reshape(1, -1)
            yhat = max(0.0, float(model.predict(feats)[0]))
            preds.append(yhat)
            hist.append(yhat)
        return np.array(preds)
    return fn
PROTOCOLS = [
    ("production: 16 folds x h=3", 16, 3),
    ("fewer:    8 folds x h=3", 8, 3),
    ("more:    24 folds x h=3", 24, 3),
    ("deeper:  16 folds x h=6", 16, 6),
    ("deepest: 16 folds x h=12", 16, 12),
]
ROUND2_SARIMA = {
    "UBEPOL BR150": ((1, 0, 1), (2, 1, 1, 12)),
    "UBEPOL BR150L": ((0, 1, 1), (0, 1, 1, 12)),
    "UBEPOL VCR617": ((1, 0, 2), (1, 1, 1, 12)),
    "UBEPOL VCR412": ((2, 0, 1), (1, 1, 1, 12)),
}
ROUND2_ETS = {
    "UBEPOL BR150": (None, False, "mul"),
    "UBEPOL BR150L": (None, False, "mul"),
    "UBEPOL VCR617": ("add", True, "mul"),
    "UBEPOL VCR412": (None, False, "add"),
}


def _stepped(series, n_folds, horizon):
    n = len(series)
    folds = []
    for k in range(horizon, n_folds + horizon):
        cutoff = n - k
        if cutoff < MIN_TRAIN:
            continue
        folds.append((series.iloc[:cutoff], series.values[cutoff:cutoff + horizon]))
    return folds


def _score(series, fn, n_folds, horizon):
    folds = _stepped(series, n_folds, horizon)
    if not folds:
        return float("nan")
    actual = np.concatenate([f[1] for f in folds])
    pred = np.concatenate([fn(f[0], horizon) for f in folds])
    return _wape(actual, pred)


def _mase(series, fn, n_folds, horizon):
    folds = _stepped(series, n_folds, horizon)
    if not folds:
        return float("nan")
    actual = np.concatenate([f[1] for f in folds])
    predicted = np.concatenate([fn(f[0], horizon) for f in folds])
    scales = [s for s in (_naive12_scale(f[0]) for f in folds) if not np.isnan(s)]
    if not scales:
        return float("nan")
    return float(np.abs(actual - predicted).mean() / np.mean(scales))


def main():
    t0 = time.time()
    billing = data.load_billing_frame()
    series_by_grade = data.pilot_series(billing)

    for grade, series in series_by_grade.items():
        train, test = _split(series)
        print(f"\n=== {grade} ===")

        cand = {
            "SeasonalNaive": naive_fn,
            "GBR-median": make_gbr(400, 0.05, 31, loss="absolute_error"),
        }
        if grade in ROUND2_SARIMA:
            cand["ETS(r2-winner)"] = make_ets(*ROUND2_ETS[grade])
            cand["SARIMA(r2-winner)"] = make_sarima(*ROUND2_SARIMA[grade])
        if grade in data.SPARSE_GRADES:
            cand["Croston"] = forecast_croston
            cand["SBA"] = forecast_sba
            cand["TSB"] = forecast_tsb
        else:
            comps = _bu_material_components(billing, grade)
            if comps:
                cand["BU-material"] = _make_bu_material(comps)

        results = []
        for label, n_folds, horizon in PROTOCOLS:
            scored = []
            for name, fn in cand.items():
                try:
                    w = _score(train, fn, n_folds, horizon)
                    m = _mase(train, fn, n_folds, horizon)
                except Exception:
                    w, m = float("nan"), float("nan")
                scored.append((name, w, m))
            finite = [s for s in scored if np.isfinite(s[1])]
            finite.sort(key=lambda s: s[1])
            champ_name, champ_w, champ_m = finite[0]
            # production-style gate: refuse a champion that fails vs naive
            if champ_name != "SeasonalNaive" and not (champ_m < 1.0):
                naive_row = next(s for s in scored if s[0] == "SeasonalNaive")
                champ_name, champ_w, champ_m = "SeasonalNaive", naive_row[1], naive_row[2]
            champ_fn = cand[champ_name]
            hold = _wape(test.values, champ_fn(train, len(test)))
            results.append((label, champ_name, champ_w, champ_m, hold))
            print(f"  {label:<26} champion {champ_name:<28} "
                  f"inner {champ_w:>7.1%}  MASE {champ_m:>5.2f}  HOLDOUT {hold:>7.1%}")

        holds = [r[4] for r in results]
        champs = {r[1] for r in results}
        print(f"  -> different champions crowned: {len(champs)} | "
              f"holdout range {min(holds):.1%} .. {max(holds):.1%} "
              f"(spread {max(holds) - min(holds):.1%})")
    print(f"\ndone in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
