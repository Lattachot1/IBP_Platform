"""
LSTM / BiLSTM demand-forecast candidates (PyTorch, CPU).

Sequence-to-one recurrent nets on a sliding window of the last `window`
months, recursive rollout for the h-step forecast. Designed for the tiny
monthly-tonnage setting (81 train months per grade):

- inputs standardized with stats from the fit region only
- optional log1p transform and month-of-year sin/cos features
- L1 loss (WAPE is minimized by the conditional median)
- early stopping on the LAST `val_months` (8) months of whatever training
  window the caller passes - validation is always inside train
- deterministic: fixed seed, single torch thread, seeded batch shuffling
- any failure falls back to seasonal-naive so the callable always returns
  h non-negative predictions
"""

import numpy as np
import pandas as pd
import torch
from torch import nn

CANDIDATE_NAME = "LSTM-BiLSTM"

_DEFAULTS = {
    "window": 24,        # input months per sample
    "hidden": 16,
    "layers": 1,
    "bidir": False,      # False -> LSTM, True -> BiLSTM
    "dropout": 0.0,      # only active when layers > 1
    "lr": 2e-3,
    "batch": 16,
    "max_epochs": 500,
    "patience": 40,      # early stopping on the 8-month validation tail
    "val_months": 8,
    "log1p": True,
    "month_feat": True,  # sin/cos month-of-year as extra input features
    "seed": 0,
}

# Tuned by inner expanding CV (5 folds x horizon 8) on 2019-04..2025-12 only.
# Findings: tiny 1-layer nets win; hidden 64 / 2 layers and window 36 all
# scored worse; raw scale beat log1p slightly; lr 1e-3 beat 2-3e-3 slightly.
# Final spread: mean inner WAPE 18.6% / 18.8% / 18.8% across the 4 grades.
CONFIGS = {
    "LSTM s16 lr1e-3 raw": dict(hidden=16, layers=1, bidir=False, lr=1e-3, log1p=False),
    "BiLSTM s16 lr1e-3 raw": dict(hidden=16, layers=1, bidir=True, lr=1e-3, log1p=False),
    "LSTM s16 lr2e-3 raw": dict(hidden=16, layers=1, bidir=False, log1p=False),
}


class _RNN(nn.Module):
    def __init__(self, n_feat, hidden, layers, bidir, dropout):
        super().__init__()
        self.rnn = nn.LSTM(
            n_feat, hidden, num_layers=layers, bidirectional=bidir,
            batch_first=True, dropout=dropout if layers > 1 else 0.0,
        )
        out_dim = hidden * (2 if bidir else 1)
        self.head = nn.Linear(out_dim, 1)

    def forward(self, x):
        out, _ = self.rnn(x)
        return self.head(out[:, -1, :]).squeeze(-1)


def _seasonal_naive(values: np.ndarray, h: int) -> np.ndarray:
    last12 = values[-12:] if len(values) >= 12 else values
    tiled = np.tile(last12, int(np.ceil(h / len(last12))))[:h]
    return np.clip(np.nan_to_num(tiled, nan=0.0), 0.0, None)


def _month_feats(months: np.ndarray) -> np.ndarray:
    ang = 2.0 * np.pi * (months - 1) / 12.0
    return np.stack([np.sin(ang), np.cos(ang)], axis=1)


def _fit_and_forecast(series: pd.Series, h: int, p: dict) -> np.ndarray:
    torch.set_num_threads(1)
    v = series.values.astype(np.float64)
    n = len(v)
    w = int(p["window"])
    if n < w + p["val_months"] + 6:
        return _seasonal_naive(v, h)

    t = np.log1p(np.clip(v, 0.0, None)) if p["log1p"] else v.copy()
    fit_len = n - int(p["val_months"])
    mu = float(np.mean(t[:fit_len]))
    sd = float(np.std(t[:fit_len]))
    if not np.isfinite(sd) or sd < 1e-8:
        sd = 1.0
    z = (t - mu) / sd

    months = np.asarray(series.index.month, dtype=float)
    cols = [z.reshape(-1, 1)]
    if p["month_feat"]:
        cols.append(_month_feats(months))
    feats = np.concatenate(cols, axis=1)  # (n, 1 or 3)

    X = np.stack([feats[i - w:i] for i in range(w, n)]).astype(np.float32)
    y = z[w:].astype(np.float32)
    targets = np.arange(w, n)
    tr_mask = targets < fit_len
    Xtr, ytr = X[tr_mask], y[tr_mask]
    Xva, yva = X[~tr_mask], y[~tr_mask]
    if len(Xtr) < 4 or len(Xva) == 0:
        return _seasonal_naive(v, h)

    torch.manual_seed(int(p["seed"]))
    model = _RNN(X.shape[2], int(p["hidden"]), int(p["layers"]),
                 bool(p["bidir"]), float(p["dropout"]))
    opt = torch.optim.Adam(model.parameters(), lr=float(p["lr"]))
    lossf = nn.L1Loss()
    Xtr_t, ytr_t = torch.tensor(Xtr), torch.tensor(ytr)
    Xva_t, yva_t = torch.tensor(Xva), torch.tensor(yva)

    bs = min(int(p["batch"]), len(Xtr))
    rng = np.random.RandomState(int(p["seed"]))
    best_val, best_state, bad = float("inf"), None, 0
    for _ in range(int(p["max_epochs"])):
        model.train()
        for s in range(0, len(Xtr), bs):
            idx = torch.tensor(rng.permutation(len(Xtr))[s:s + bs])
            opt.zero_grad()
            loss = lossf(model(Xtr_t[idx]), ytr_t[idx])
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            loss.backward()
            opt.step()
        model.eval()
        with torch.no_grad():
            val = float(lossf(model(Xva_t), yva_t))
        if val < best_val - 1e-6:
            best_val, bad = val, 0
            best_state = {k: t_.detach().clone() for k, t_ in model.state_dict().items()}
        else:
            bad += 1
            if bad >= int(p["patience"]):
                break
    if best_state is not None:
        model.load_state_dict(best_state)

    # recursive rollout: feed predictions back, with true calendar features
    model.eval()
    freq = series.index.freq or "M"
    fut = pd.period_range(series.index[-1] + 1, periods=int(h), freq=freq)
    tail = feats[-w:].astype(np.float32).copy()
    zs = []
    with torch.no_grad():
        for period in fut:
            x = torch.tensor(tail[None, :, :])
            zhat = float(model(x)[0])
            zs.append(zhat)
            row = [zhat]
            if p["month_feat"]:
                row.extend(_month_feats(np.array([period.month]))[0])
            tail = np.vstack([tail[1:], np.array(row, dtype=np.float32)])

    zarr = np.array(zs)
    out = np.expm1(zarr * sd + mu) if p["log1p"] else zarr * sd + mu
    return np.clip(np.nan_to_num(out, nan=0.0), 0.0, None)


def make_fn(params: dict):
    p = {**_DEFAULTS, **(params or {})}

    def fn(series_train: pd.Series, h: int) -> np.ndarray:
        try:
            return _fit_and_forecast(series_train, int(h), p)
        except Exception:
            try:
                return _seasonal_naive(series_train.values.astype(float), int(h))
            except Exception:
                return np.zeros(int(h))
    return fn
