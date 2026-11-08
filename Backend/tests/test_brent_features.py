"""Brent regressor context: loader behavior and the GB feature contract."""

import numpy as np
import pandas as pd
import pytest

from forecasting import data, models


@pytest.fixture(autouse=True)
def reset_brent_cache():
    models._BRENT_CACHE = None
    yield
    models._BRENT_CACHE = None


def _series(n=30):
    idx = pd.period_range("2024-01", periods=n, freq="M")
    return pd.Series([100.0 + 5.0 * (i % 3) for i in range(n)], index=idx)


def test_brent_monthly_reads_fred_format(tmp_path, monkeypatch):
    (tmp_path / "fred_brent.csv").write_text(
        "observation_date,POILBREUSDM\n2024-01-01,80\n2024-02-01,82\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(data, "DATA_DIR", tmp_path)
    s = data.brent_monthly()
    assert s is not None and list(s.index.astype(str)) == ["2024-01", "2024-02"]
    assert float(s.iloc[0]) == 80.0


def test_brent_monthly_missing_file_is_none(tmp_path, monkeypatch):
    monkeypatch.setattr(data, "DATA_DIR", tmp_path)
    assert data.brent_monthly() is None


def test_gbr_median_answers_without_brent(monkeypatch):
    monkeypatch.setattr(data, "brent_monthly", lambda: None)
    out = models.forecast_gbr_median(_series(), 5)
    assert len(out) == 5
    assert np.all(np.isfinite(out)) and np.all(out >= 0)


def test_gbr_median_answers_with_brent():
    out = models.forecast_gbr_median(_series(), 5)   # real DemandModel data
    assert len(out) == 5
    assert np.all(np.isfinite(out)) and np.all(out >= 0)
