"""
Candidate family: classic scikit-learn ML on lag features
- Random Forest + ANN (MLPRegressor).

Same feature philosophy as the production GBR (lags 1/2/3/12, rolling
means 3/6/12, month sin/cos, month/12) with two different learners:

- Random Forest: bagged trees, robust on tiny data (~45-60 training rows
  per model). We compare the squared-error vs absolute-error split
  criterion (WAPE is an MAE metric, so the median-targeting criterion
  matches the metric directly, like GBR-median does) and both a
  recursive and a direct per-horizon forecast strategy.
- ANN: a small MLP trained with ADAM in fixed 50-iteration rounds and
  MANUAL early stopping: validation = the LAST 8 months of whichever
  training window the caller passed (always inside the training split,
  never 2026). We snapshot the network after each round with
  copy.deepcopy and keep the one with the best validation MAE, so epochs
  are hard-capped (40 x 50 = 2000 iterations max) and the result is
  deterministic (fixed seed, no sklearn-internal random val split).

Strategies:
- "direct": one model per step s = 1..max(h, 8), trained to predict the
  value exactly s months after the origin from the same lag features.
  No error accumulation across the horizon, at the cost of s fewer rows
  for step-s models. Steps beyond the trained range (never happens with
  h=8, but kept safe) fall back to seasonal-naive values.
- "recursive": one one-step model, iterate h times feeding predictions
  back into the lag window.

Determinism: random_state fixed everywhere; RF uses n_jobs=1 so tree
predictions are always summed in the same order (no float reassociation
across thread schedules). Every forecast path is wrapped so any failure
falls back to a seasonal-naive answer, clamped >= 0.
"""

import copy
import warnings

import numpy as np

from sklearn.ensemble import RandomForestRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.neural_network import MLPRegressor

CANDIDATE_NAME = "Random Forest + ANN (sklearn)"

SEED = 0
VAL_MONTHS = 8     # early-stopping validation = last 8 months of the window
MAX_STEP = 12      # direct models are trained for steps 1..MAX_STEP
MIN_MONTHS = 16    # below this window length, fall back to seasonal naive
ANN_ROUNDS = 40    # x 50 iters per round = 2000 iterations hard cap
ANN_PATIENCE = 6   # stop after this many rounds without val improvement


# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------
def _seasonal_naive(v: np.ndarray, h: int) -> np.ndarray:
    if len(v) >= 12:
        out = np.array([v[-12 + (i % 12)] for i in range(h)], dtype=float)
    else:
        out = np.full(h, float(v[-1]) if len(v) else 0.0, dtype=float)
    return np.maximum(np.nan_to_num(out, nan=0.0), 0.0)


def _features(hist: np.ndarray, target_month: int) -> list:
    return [
        hist[-1], hist[-2], hist[-3], hist[-12],          # lags 1/2/3/12
        hist[-3:].mean(), hist[-6:].mean(), hist[-12:].mean(),
        np.sin(2 * np.pi * (target_month - 1) / 12.0),    # season position
        np.cos(2 * np.pi * (target_month - 1) / 12.0),
        target_month / 12.0,
    ]


def _target_month(last_month: int, step: int) -> int:
    return (last_month + step - 1) % 12 + 1


def _rows_for_step(v: np.ndarray, months: np.ndarray, step: int):
    """Rows predicting v[t+step] from history v[:t+1].

    Returns X, y (fit rows) and Xv, yv (validation rows = targets in the
    last VAL_MONTHS months of the window, used only by the ANN).
    """
    n = len(v)
    X, y, Xv, yv = [], [], [], []
    for t in range(12, n):
        tt = t + step
        if tt >= n:
            break
        row = _features(v[: t + 1], int(months[tt]))
        if tt >= n - VAL_MONTHS:
            Xv.append(row)
            yv.append(v[tt])
        else:
            X.append(row)
            y.append(v[tt])
    return np.array(X), np.array(y), np.array(Xv), np.array(yv)


def _clean(pred, fallback: float) -> float:
    p = float(pred)
    if not np.isfinite(p):
        p = float(fallback)
    return max(0.0, p)


# ---------------------------------------------------------------------------
# learners
# ---------------------------------------------------------------------------
def _fit_rf(params: dict, X: np.ndarray, y: np.ndarray) -> RandomForestRegressor:
    rf = RandomForestRegressor(
        n_estimators=int(params.get("n_estimators", 400)),
        max_depth=params.get("max_depth"),
        min_samples_leaf=int(params.get("min_samples_leaf", 1)),
        criterion=params.get("criterion", "squared_error"),
        max_features=params.get("max_features", 1.0),
        random_state=SEED,
        n_jobs=1,
    )
    rf.fit(X, y)
    return rf


def _fit_ann(params: dict, X: np.ndarray, y: np.ndarray, Xv: np.ndarray,
             yv: np.ndarray):
    """Small MLP with manual round-based early stopping.

    Scaling stats come from the fit rows only. Returns
    (net, mu, sd, ymu, ysd) - net is the round snapshot with the best
    validation MAE (or the last net when there are no validation rows).
    """
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd = np.where(sd <= 1e-12, 1.0, sd)
    ymu = float(y.mean()) if len(y) else 0.0
    ysd = float(y.std()) if len(y) else 1.0
    if not np.isfinite(ysd) or ysd <= 1e-12:
        ysd = 1.0

    Xs = (X - mu) / sd
    ys = (y - ymu) / ysd

    net = MLPRegressor(
        hidden_layer_sizes=tuple(params.get("hidden", (64, 32))),
        activation=params.get("activation", "relu"),
        solver="adam",
        alpha=float(params.get("alpha", 0.03)),
        batch_size=int(min(32, max(4, len(Xs)))),
        learning_rate_init=float(params.get("lr", 1e-3)),
        max_iter=50,
        tol=1e-8,
        shuffle=True,
        random_state=SEED,
        warm_start=True,
    )
    best_net, best_score, stale = None, np.inf, 0
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)
        for _ in range(ANN_ROUNDS):
            net.fit(Xs, ys)
            if len(Xv):
                pv = net.predict((np.asarray(Xv, dtype=float) - mu) / sd)
                pv = pv * ysd + ymu
                score = float(np.abs(pv - np.asarray(yv, dtype=float)).mean())
            else:
                score = float("nan")
            if np.isfinite(score) and score < best_score - 1e-9:
                best_score, best_net, stale = score, copy.deepcopy(net), 0
            else:
                stale += 1
                if best_net is not None and stale >= ANN_PATIENCE:
                    break
    if best_net is None:
        best_net = net
    return best_net, mu, sd, ymu, ysd


def _ann_predict(art, row) -> float:
    net, mu, sd, ymu, ysd = art
    x = (np.asarray(row, dtype=float).reshape(1, -1) - mu) / sd
    return float(net.predict(x)[0]) * ysd + ymu


# ---------------------------------------------------------------------------
# forecast entry point
# ---------------------------------------------------------------------------
def make_fn(params: dict):
    """Return fn(series_train, h) -> h clamped, deterministic predictions."""

    def fn(series_train, h: int) -> np.ndarray:
        v = np.asarray(series_train.values, dtype=float)
        try:
            months = np.asarray(series_train.index.month, dtype=int)
            if len(v) < MIN_MONTHS or h < 1:
                return _seasonal_naive(v, h)

            kind = params.get("model", "rf")
            strategy = params.get("strategy", "direct")

            if strategy == "recursive":
                # one one-step model; early stopping validates the same
                # last-8-months targets one step ahead
                X, y, Xv, yv = _rows_for_step(v, months, 1)
                model = art = None
                if kind == "rf":
                    model = _fit_rf(params, X, y)
                else:
                    art = _fit_ann(params, X, y, Xv, yv)
                hist = list(v)
                m = int(months[-1])
                out = []
                for _ in range(h):
                    m = m % 12 + 1
                    row = _features(np.asarray(hist, dtype=float), m)
                    if model is not None:
                        raw = float(model.predict(
                            np.asarray(row, dtype=float).reshape(1, -1))[0])
                    else:
                        raw = _ann_predict(art, row)
                    pred = _clean(raw, float(np.mean(hist[-12:])))
                    out.append(pred)
                    hist.append(pred)
                return np.asarray(out, dtype=float)

            # direct: one model per step
            models, arts = {}, {}
            for s in range(1, min(max(h, 8), MAX_STEP) + 1):
                X, y, Xv, yv = _rows_for_step(v, months, s)
                if len(X) + len(Xv) < 6:  # too few rows for this step
                    break
                if kind == "rf":
                    models[s] = _fit_rf(params, X, y)
                else:
                    arts[s] = _fit_ann(params, X, y, Xv, yv)
            hist = list(v)
            m0 = int(months[-1])
            out = []
            for s in range(1, h + 1):
                m = _target_month(m0, s)
                row = _features(np.asarray(hist, dtype=float), m)
                if s in models:
                    raw = float(models[s].predict(
                        np.asarray(row, dtype=float).reshape(1, -1))[0])
                elif s in arts:
                    raw = _ann_predict(arts[s], row)
                else:  # step beyond trained range -> seasonal naive value
                    raw = hist[-12] if len(hist) >= 12 else float(np.mean(hist))
                pred = _clean(raw, float(np.mean(hist[-12:])))
                out.append(pred)
                hist.append(pred)
            return np.asarray(out, dtype=float)
        except Exception:
            return _seasonal_naive(v, h)

    return fn


# Frozen after inner-CV tuning (21 variants over 3 phases; per-grade mean
# inner WAPE across the 4 pilot grades, train period only):
#   ANN (32,16) a=0.03        18.9%   <- best overall
#   RF abs d4 l1 sqrt         19.0%
#   RF abs d6 l1 sqrt         19.1%
#   ANN (32,16) a=0.01        19.1%
#   RF sq d6 l1 sqrt          19.3%   <- kept for criterion diversity
#   RF sq d6 l1 (no sqrt)     20.0%
#   RF recursive variants     20.1-20.6% (error compounding hurts VCR617)
#   ANN (64,32)/(32,)/(16,)   20.8-22.4% (bigger nets overfit ~50-row data)
# naive seasonal baseline mean: 27.8%
CONFIGS = {
    "ANN direct (32,16) a=0.03": {
        "model": "ann", "strategy": "direct", "hidden": [32, 16],
        "alpha": 0.03,
    },
    "RF direct abs-err d4 leaves=1 sqrt": {
        "model": "rf", "strategy": "direct", "n_estimators": 400,
        "max_depth": 4, "min_samples_leaf": 1,
        "criterion": "absolute_error", "max_features": "sqrt",
    },
    "RF direct sq-err d6 leaves=1 sqrt": {
        "model": "rf", "strategy": "direct", "n_estimators": 400,
        "max_depth": 6, "min_samples_leaf": 1,
        "criterion": "squared_error", "max_features": "sqrt",
    },
}
