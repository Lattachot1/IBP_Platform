"""Candidate model modules from the model-comparison round.

Each module exposes:
  CANDIDATE_NAME : str   - family label
  CONFIGS        : dict  - {config_name: params_dict}
  make_fn(params) -> callable(series_train: pd.Series, h: int) -> np.ndarray

Contract: predictions are length h, non-negative, deterministic (fixed seed).
Models are month-aware: series_train carries a monthly PeriodIndex.
"""
