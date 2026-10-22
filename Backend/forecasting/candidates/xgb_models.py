"""
XGBoost Regressor candidates for the monthly demand-forecast comparison.

Gradient-boosted trees on lag / rolling / calendar features, trained with
absolute-error loss (``reg:absoluteerror``). WAPE is minimised by the
conditional MEDIAN, so median-loss boosting is the variant that directly
targets the metric this project reports.

Two shapes (selected by the ``strategy`` param):
- "direct": one small model per horizon step 1..8. At prediction time the
  feature row is built once from the observed history - no recursive
  feedback of predictions into features.
- "single": one model for all steps, with the step index as a feature;
  ~8x more rows per model, which helps on 40-80 row training windows.

Features per example, "as of" the last observed month t (0-based) with
target month t+s:
  lags 1/2/3/12, rolling means 3/6/12, target-month sin/cos, and the value
  of the same calendar month one year BEFORE THE TARGET MONTH (known
  without recursion for s <= 8). Early-history lags are NaN - xgboost
  handles missing values natively.

Early stopping uses the LAST 8 months of each training window as the
validation set (validation targets sit inside the window, so nothing
outside the training period is ever touched). Determinism: fixed
random_state, single-threaded histogram trees, no sampling randomness
beyond what the seeded subsample controls.

Fallback: any failure (too-short series, fit error) returns a seasonal
naive forecast, so the callable always answers.
"""

import numpy as np

MAX_STEP = 8          # direct models exist for steps 1..8 (inner/holdout horizon)
MIN_ROWS = 15         # below this, seasonal naive
VAL_MONTHS = 8        # early-stopping validation = last 8 months of the window

CANDIDATE_NAME = "XGBoost Regressor"


def _seasonal_naive(v: np.ndarray, h: int) -> np.ndarray:
    if len(v) < 12:
        return np.full(h, float(v.mean()) if len(v) else 0.0)
    reps = int(np.ceil(h / 12))
    return np.tile(v[-12:], reps)[:h]


def _row(v: np.ndarray, t: int, step: int, m_now: int, with_step: bool) -> list:
    """Feature row for 'now' index t, predicting month t+step."""
    tm = ((m_now - 1 + step) % 12) + 1
    ang = 2.0 * np.pi * (tm - 1) / 12.0
    feat = [
        v[t],                                        # lag 1
        v[t - 1],                                    # lag 2
        v[t - 2],                                    # lag 3
        v[t - 11] if t >= 12 else np.nan,            # lag 12
        v[t - 2 : t + 1].mean(),                     # rolling mean 3
        v[t - 5 : t + 1].mean(),                     # rolling mean 6
        v[t - 11 : t + 1].mean(),                    # rolling mean 12
        np.sin(ang),                                 # target-month season
        np.cos(ang),
        v[t + step - 12] if t + step - 12 >= 0 else np.nan,  # target month, 1y ago
    ]
    if with_step:
        feat.append(float(step))
    return feat


def _fit_model(params: dict, X_tr, y_tr, X_va, y_va):
    from xgboost import XGBRegressor

    model = XGBRegressor(
        n_estimators=int(params.get("n_estimators", 400)),
        max_depth=int(params.get("max_depth", 3)),
        learning_rate=float(params.get("learning_rate", 0.05)),
        objective="reg:absoluteerror",
        tree_method="hist",
        min_child_weight=float(params.get("min_child_weight", 1.0)),
        subsample=float(params.get("subsample", 1.0)),
        colsample_bytree=float(params.get("colsample_bytree", 1.0)),
        reg_lambda=float(params.get("reg_lambda", 1.0)),
        early_stopping_rounds=int(params.get("early_stopping_rounds", 25)),
        eval_metric="mae",
        random_state=0,
        n_jobs=1,
    )
    model.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
    return model


def _datasets(v, months, max_step, strategy):
    """Build train/validation matrices inside one training window.

    Validation = examples whose TARGET month is one of the last VAL_MONTHS
    months of the window (target index >= n - VAL_MONTHS). Direct strategy
    returns one (X_tr, y_tr, X_va, y_va) per step; single returns one
    combined set (or None per step when there are no rows).
    """
    n = len(v)
    direct, combined_tr, combined_va = [], ([], []), ([], [])
    for s in range(1, max_step + 1):
        tr, va = ([], []), ([], [])
        for t in range(11, n - s):
            row = _row(v, t, s, int(months[t]), with_step=(strategy == "single"))
            target = v[t + s]
            if t + s >= n - VAL_MONTHS:
                (va[0].append(row), va[1].append(target))
            else:
                (tr[0].append(row), tr[1].append(target))
        if tr[0] and va[0]:
            if strategy == "direct":
                direct.append((s, np.array(tr[0]), np.array(tr[1]),
                               np.array(va[0]), np.array(va[1])))
            else:
                combined_tr[0].extend(tr[0]); combined_tr[1].extend(tr[1])
                combined_va[0].extend(va[0]); combined_va[1].extend(va[1])
        elif strategy == "direct":
            direct.append((s, None, None, None, None))
    if strategy == "single":
        if not combined_tr[0]:
            return None
        return (np.array(combined_tr[0]), np.array(combined_tr[1]),
                np.array(combined_va[0]), np.array(combined_va[1]))
    return direct


def make_fn(params: dict):
    """Return fn(series_train, h) -> h clamped, deterministic predictions."""
    params = dict(params or {})
    strategy = params.get("strategy", "direct")
    if strategy not in ("direct", "single"):
        raise ValueError(f"unknown strategy {strategy!r}")

    def fn(series_train, h: int) -> np.ndarray:
        v = np.asarray(series_train.values, dtype=float)
        if len(v) < MIN_ROWS:
            return _seasonal_naive(v, h)
        try:
            months = series_train.index.month.to_numpy()
            n = len(v)
            ds = _datasets(v, months, MAX_STEP, strategy)
            naive = _seasonal_naive(v, h)
            preds = np.array(naive, dtype=float)  # spliced for uncovered steps
            if strategy == "direct":
                for s, X_tr, y_tr, X_va, y_va in ds:
                    if s > h or X_tr is None:
                        continue
                    model = _fit_model(params, X_tr, y_tr, X_va, y_va)
                    x = np.array([_row(v, n - 1, s, int(months[-1]),
                                       with_step=False)])
                    preds[s - 1] = max(0.0, float(model.predict(x)[0]))
            else:
                if ds is not None:
                    model = _fit_model(params, ds[0], ds[1], ds[2], ds[3])
                    for s in range(1, min(h, MAX_STEP) + 1):
                        x = np.array([_row(v, n - 1, s, int(months[-1]),
                                           with_step=True)])
                        preds[s - 1] = max(0.0, float(model.predict(x)[0]))
            return preds
        except Exception:
            return _seasonal_naive(v, h)

    return fn


CONFIGS = {
    # best mean inner CV across the 4 grades (18.6%)
    "single MAE d3 lr.05 sub.9 col.8": {
        "strategy": "single", "max_depth": 3, "learning_rate": 0.05,
        "n_estimators": 400, "subsample": 0.9, "colsample_bytree": 0.8,
    },
    # heavy-shrinkage variant, nearly tied (18.8%)
    "single MAE d3 mcw10 rl10": {
        "strategy": "single", "max_depth": 3, "learning_rate": 0.05,
        "n_estimators": 400, "min_child_weight": 10, "reg_lambda": 10,
    },
    # direct per-horizon shape (one model per step 1..8), 19.5% - kept for
    # shape diversity; single-model beat it slightly on this data size
    "direct MAE d3 lr.05 n400": {
        "strategy": "direct", "max_depth": 3, "learning_rate": 0.05,
        "n_estimators": 400,
    },
}
