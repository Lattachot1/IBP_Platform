"""CNN and CNN-hybrid candidates (PyTorch CPU): CNN1D, LSTM+CNN, BiLSTM+CNN.

Family module for the model-comparison round; see candidates/__init__.py
for the shared contract (CONFIGS + make_fn -> fn(series_train, h) ->
np.ndarray of length h, non-negative, deterministic).

Design notes
------------
- Input: a sliding window of the last `window` standardized months
  (default 24), one sample per position; the target is the NEXT month's
  level value.
- Standardization uses mean/std of the fitting window EXCLUDING its last
  8 months, which serve as the early-stopping validation tail - so the
  scaler never sees the validation targets.
- Nets are deliberately tiny (a few thousand parameters): on the 41-81
  month fitting windows here there are only ~9-49 training samples.
- L1Loss everywhere: WAPE is minimized by the conditional median.
- Forecast = recursive rollout one month at a time for h steps.
- Deterministic: fixed seed per fit, single torch thread.
- Any failure inside the fit/rollout falls back to a seasonal-naive
  answer, so the callable always returns h non-negative numbers.
"""

import numpy as np
import torch
from torch import nn

CANDIDATE_NAME = "CNN & hybrids (PyTorch)"

# Last N months of each fitting window = early-stopping validation set
_VAL_TAIL = 8


# ---------------------------------------------------------------------------
# Fallback
# ---------------------------------------------------------------------------
def _snaive(v, h):
    """Seasonal-naive (period 12) fallback; always returns h non-negatives."""
    v = np.nan_to_num(np.asarray(v, dtype=float), nan=0.0)
    if len(v) >= 12:
        out = np.resize(v[-12:], int(h))
    else:
        out = np.full(int(h), v[-1] if len(v) else 0.0)
    out = np.asarray(out, dtype=float)
    return np.maximum(np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0), 0.0)


# ---------------------------------------------------------------------------
# Tiny networks
# ---------------------------------------------------------------------------
class _CNN(nn.Module):
    """Conv1d(1->ch,k3) -> Conv1d(ch->ch,k3) -> maxpool2 -> FC head."""

    def __init__(self, window, channels):
        super().__init__()
        self.body = nn.Sequential(
            nn.Conv1d(1, channels, 3, padding=1), nn.ReLU(),
            nn.Conv1d(channels, channels, 3, padding=1), nn.ReLU(),
            nn.MaxPool1d(2), nn.Flatten(),
            nn.Linear(channels * (window // 2), 16), nn.ReLU(),
            nn.Linear(16, 1),
        )

    def forward(self, x):                      # x: (B, W)
        return self.body(x.unsqueeze(1)).squeeze(-1)


class _RNNCNN(nn.Module):
    """LSTM/BiLSTM encoder over the window feeding a Conv1d + FC head."""

    def __init__(self, hidden, channels, bidir):
        super().__init__()
        self.rnn = nn.LSTM(1, hidden, batch_first=True, bidirectional=bidir)
        d = hidden * (2 if bidir else 1)
        self.head = nn.Sequential(
            nn.Conv1d(d, channels, 3, padding=1), nn.ReLU(),
            nn.AdaptiveAvgPool1d(4), nn.Flatten(),
            nn.Linear(channels * 4, 16), nn.ReLU(),
            nn.Linear(16, 1),
        )

    def forward(self, x):                      # x: (B, W)
        out, _ = self.rnn(x.unsqueeze(-1))     # (B, W, d)
        return self.head(out.transpose(1, 2)).squeeze(-1)


# ---------------------------------------------------------------------------
# Training / rollout
# ---------------------------------------------------------------------------
def _train(v, params):
    """Train one net on raw values v; return rollout(h) or None if unusable."""
    window = int(params.get("window", 24))
    arch = params.get("arch", "cnn")
    epochs = int(params.get("epochs", 500))
    patience = int(params.get("patience", 40))
    lr = float(params.get("lr", 1e-3))
    batch = int(params.get("batch", 16))
    seed = int(params.get("seed", 0))

    head = v[:-_VAL_TAIL]                      # scaler excludes the val tail
    mu = float(np.mean(head))
    sd = float(np.std(head))
    if not np.isfinite(sd) or sd < 1e-9:
        sd = 1.0
    z = (v - mu) / sd

    n = len(z)
    X = np.stack([z[i:i + window] for i in range(n - window)]).astype(np.float32)
    y = z[window:].astype(np.float32)
    ntr = len(X) - _VAL_TAIL                   # last 8 windows = validation
    if ntr < 4:
        return None
    Xt, yt = torch.tensor(X[:ntr]), torch.tensor(y[:ntr])
    Xv, yv = torch.tensor(X[ntr:]), torch.tensor(y[ntr:])

    torch.manual_seed(seed)
    np.random.seed(seed)
    prev_threads = torch.get_num_threads()
    torch.set_num_threads(1)
    try:
        if arch == "cnn":
            net = _CNN(window, int(params.get("channels", 16)))
        elif arch == "lstm_cnn":
            net = _RNNCNN(int(params.get("hidden", 16)),
                          int(params.get("channels", 16)), False)
        elif arch == "bilstm_cnn":
            net = _RNNCNN(int(params.get("hidden", 16)),
                          int(params.get("channels", 16)), True)
        else:
            return None
        opt = torch.optim.Adam(net.parameters(), lr=lr,
                               weight_decay=float(params.get("weight_decay", 1e-5)))
        lossf = nn.L1Loss()
        best, best_state, bad = float("inf"), None, 0
        for _ in range(epochs):
            net.train()
            perm = torch.randperm(len(Xt))
            for s in range(0, len(Xt), batch):
                idx = perm[s:s + batch]
                opt.zero_grad()
                loss = lossf(net(Xt[idx]), yt[idx])
                loss.backward()
                opt.step()
            net.eval()
            with torch.no_grad():
                vloss = float(lossf(net(Xv), yv))
            if vloss < best - 1e-6:
                best = vloss
                best_state = {k: t.detach().clone()
                              for k, t in net.state_dict().items()}
                bad = 0
            else:
                bad += 1
                if bad >= patience:
                    break
        if best_state is not None:
            net.load_state_dict(best_state)
        net.eval()
    finally:
        torch.set_num_threads(prev_threads)

    def rollout(h):
        buf = list(((v[-window:] - mu) / sd).astype(np.float32))
        zs = []
        with torch.no_grad():
            for _ in range(int(h)):
                x = torch.tensor(
                    np.asarray(buf[-window:], dtype=np.float32).reshape(1, -1))
                zn = float(net(x)[0])
                if not np.isfinite(zn):
                    zn = float(buf[-1])
                zs.append(zn)
                buf.append(zn)
        pred = np.asarray(zs, dtype=float) * sd + mu
        if not np.all(np.isfinite(pred)):
            pred = np.where(np.isfinite(pred), pred, _snaive(v, int(h)))
        return np.maximum(pred, 0.0)

    return rollout


def _forecast(series_train, h, params):
    v = np.asarray(series_train.values, dtype=float)
    if not np.all(np.isfinite(v)):
        med = np.nanmedian(v[np.isfinite(v)]) if np.isfinite(v).any() else 0.0
        v = np.nan_to_num(v, nan=float(med))
    window = int(params.get("window", 24))
    if len(v) < window + _VAL_TAIL + 4 or int(h) < 1:
        return _snaive(v, max(int(h), 1))
    roll = _train(v, params)
    if roll is None:
        return _snaive(v, int(h))
    return roll(int(h))


def make_fn(params):
    def fn(series_train, h):
        try:
            return _forecast(series_train, int(h), params)
        except Exception:
            try:
                return _snaive(np.asarray(series_train.values, dtype=float),
                               int(h))
            except Exception:
                return np.zeros(int(h))
    return fn


# ---------------------------------------------------------------------------
# Configs: frozen to the best 3 of 18 tested on inner CV (5 folds x h=8,
# train 2019-04..2025-12 only). One config per architecture; means were
# 18.5% (LSTM+CNN), 18.7% (CNN) and 19.4% (BiLSTM+CNN).
# ---------------------------------------------------------------------------
CONFIGS = {
    "LSTM+CNN h16": dict(arch="lstm_cnn", window=24, hidden=16, channels=16,
                         lr=1e-3, epochs=500, patience=40, seed=0),
    "CNN ch8 w18": dict(arch="cnn", window=18, channels=8,
                        lr=1e-3, epochs=500, patience=40, seed=0),
    "BiLSTM+CNN h32": dict(arch="bilstm_cnn", window=24, hidden=32, channels=16,
                           lr=1e-3, epochs=500, patience=40, seed=0),
}
