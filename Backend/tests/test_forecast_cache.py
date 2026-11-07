"""Cache round-trip for the forecast engine: fingerprint-keyed save/load.

The engine is joblib-dumped next to a sha256 of the billing extract, so a
restart loads instantly while unchanged data and retrains when it changed.
"""

import pytest

from api import forecast
from forecasting import data


@pytest.fixture
def cache_path(tmp_path, monkeypatch):
    path = tmp_path / "engine.joblib"
    monkeypatch.setattr(forecast, "_cache_path", lambda: path)
    return path


@pytest.fixture
def billing_file(tmp_path, monkeypatch):
    """A tiny fake billing extract so the fingerprint is stable and known."""
    source = tmp_path / "billing.csv"
    source.write_text("row 1\nrow 2", encoding="utf-8")
    monkeypatch.setattr(data, "find_source_file", lambda path=None: source)
    return source


def _engine():
    return {"grades": {"G": {"champion": "SeasonalNaive(m=12)"}}, "series": {}, "trained_at": "t"}


def test_roundtrip(cache_path, billing_file):
    assert forecast._load_cached_engine() is None          # nothing saved yet
    forecast._save_cached_engine(_engine())
    loaded = forecast._load_cached_engine()
    assert loaded is not None and loaded["loaded_from_cache"] is True
    assert loaded["grades"]["G"]["champion"] == "SeasonalNaive(m=12)"


def test_changed_billing_data_invalidates(cache_path, billing_file):
    forecast._save_cached_engine(_engine())
    billing_file.write_text("row 1\nrow 2 CHANGED", encoding="utf-8")
    assert forecast._load_cached_engine() is None


def test_old_cache_version_invalidates(cache_path, billing_file, monkeypatch):
    forecast._save_cached_engine(_engine())
    monkeypatch.setattr(forecast, "CACHE_VERSION", forecast.CACHE_VERSION + 1)
    assert forecast._load_cached_engine() is None


def test_skip_train_leaves_the_engine_unavailable(monkeypatch, cache_path):
    monkeypatch.setenv("IBP_SKIP_TRAIN", "1")
    monkeypatch.setattr(forecast, "forecast_engine", None)
    monkeypatch.setattr(forecast, "_training", {"state": "idle", "started_at": None, "error": None})
    forecast.train_at_startup()
    assert forecast.forecast_engine is None
    assert forecast._training["state"] == "idle"           # no thread started


def test_engine_status_reports_training(monkeypatch):
    monkeypatch.setattr(forecast, "forecast_engine", None)
    monkeypatch.setattr(
        forecast, "_training",
        {"state": "training", "started_at": "2026-11-07T00:00:00+00:00", "error": None},
    )
    assert forecast.engine_status() == {
        "status": "training", "started_at": "2026-11-07T00:00:00+00:00",
    }
