"""
Central holdout shootout: the 10 new challenger configs (top-2 per family)
plus the 5 current reference models, evaluated ONCE on the same holdout
(2026-01..2026-08). Full table printed for every candidate, no omissions.

Run:  cd Backend && python -m forecasting.holdout_shootout
"""

import time

import numpy as np
import pandas as pd

from . import data
from .backtest import _wape, MODELS
from .service import _bu_material_components, _make_bu_material
from .candidates import (
    arima_models, cnn_models, lstm_models, sklearn_models, xgb_models,
)

TRAIN_END = pd.Period("2025-12", freq="M")


def _split(series):
    train = series[series.index <= TRAIN_END]
    test = series[series.index > TRAIN_END]
    return train, test


def naive_fn(series_train, h):
    from .models import forecast_seasonal_naive
    return forecast_seasonal_naive(series_train, h)

NEW_FAMILIES = [
    (sklearn_models, ["ANN direct (32,16) a=0.03", "RF direct abs-err d4 leaves=1 sqrt"]),
    (xgb_models, ["single MAE d3 lr.05 sub.9 col.8", "single MAE d3 mcw10 rl10"]),
    (lstm_models, ["LSTM s16 lr1e-3 raw", "BiLSTM s16 lr1e-3 raw"]),
    (cnn_models, ["LSTM+CNN h16", "CNN ch8 w18"]),
    (arima_models, ["ARIMA (2,1,2)", "ARIMA (1,1,1)"]),
]


def _get_config_candidate(module, name):
    if name not in module.CONFIGS:
        raise KeyError(f"{module.__name__}: '{name}' not in CONFIGS "
                       f"(has: {sorted(module.CONFIGS)})")
    return module.make_fn(module.CONFIGS[name])


def _median4():
    base = list(MODELS.values())

    def fn(series_train, h):
        return np.median(np.array([f(series_train, h) for f in base]), axis=0)
    return fn


def main():
    t0 = time.time()
    billing = data.load_billing_frame()
    series_by_grade = data.pilot_series(billing)
    summary = {}
    for grade, series in series_by_grade.items():
        train, test = _split(series)
        cand = {
            "SeasonalNaive (baseline)": naive_fn,
            "SARIMA(1,0,1)(1,1,1) [prod]": MODELS["SARIMA(1,0,1)(1,1,1,12)"],
            "GBR-median [prod]": MODELS["GBR-median(lags+calendar)"],
            "MED-ENS(4) [prod]": _median4(),
            "BU-material [prod]": _make_bu_material(
                _bu_material_components(billing, grade)),
        }
        for module, names in NEW_FAMILIES:
            family = module.CANDIDATE_NAME
            for nm in names:
                try:
                    cand[f"{family}: {nm}"] = _get_config_candidate(module, nm)
                except KeyError as exc:
                    print(f"    !! {exc}")
                    continue

        rows = []
        for name, fn in cand.items():
            try:
                pred = np.asarray(fn(train, len(test)), dtype=float)
                rows.append({"candidate": name, "holdout_wape": _wape(test.values, pred)})
            except Exception as exc:
                rows.append({"candidate": name, "holdout_wape": float("nan"),
                             "error": str(exc)[:120]})
        rows.sort(key=lambda r: r["holdout_wape"] if np.isfinite(r["holdout_wape"]) else 9e9)

        print(f"\n=== {grade} (holdout {test.index[0]}..{test.index[-1]}, {len(test)} mo) ===")
        for r in rows:
            if np.isfinite(r["holdout_wape"]):
                mark = "  <= 10%" if r["holdout_wape"] <= 0.10 else ""
                print(f"    {r['candidate']:<48} {r['holdout_wape']:>7.1%}{mark}")
            else:
                print(f"    {r['candidate']:<48}   FAILED: {r.get('error','')}")
        best = rows[0]
        summary[grade] = {"best": best["candidate"],
                          "best_holdout_wape": best["holdout_wape"],
                          "candidates": rows}

    naive_avg = np.mean([np.mean([r["holdout_wape"] for r in summary[g]["candidates"]
                                  if r["candidate"].startswith("SeasonalNaive")])
                         for g in summary])
    best_avg = np.mean([summary[g]["best_holdout_wape"] for g in summary])
    print(f"\n=== SUMMARY ===")
    for g in summary:
        print(f"  {g:<15} best {summary[g]['best_holdout_wape']:.1%}  ({summary[g]['best']})")
    print(f"  best-per-grade average: {best_avg:.1%} | naive average: {naive_avg:.1%}")
    print(f"  holdout pass complete in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
