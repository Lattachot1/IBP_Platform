"""
Forecast engine state shared by the forecast router and /api/health.

Training needs the client's billing data (never in git), so these tests
replace forecasting.service.train_all with a stub engine.
"""

import pytest
from fastapi.testclient import TestClient

import main
from api import forecast
from forecasting import service

client = TestClient(main.app)

STUB_ENGINE = {
    "trained_at": "2026-11-05T00:00:00+00:00",
    "grades": {"UBEPOL BR150": {"champion": "SeasonalNaive(m=12)", "wape": 0.2}},
    "series": {},
}


@pytest.fixture(autouse=True)
def no_engine(monkeypatch):
    monkeypatch.setattr(forecast, "forecast_engine", None)


def test_retrain_replaces_the_engine_and_health_reports_it(monkeypatch):
    monkeypatch.setattr(service, "train_all", lambda: STUB_ENGINE)

    res = client.post("/api/v1/retrain")
    assert res.status_code == 200
    assert res.json()["grades"] == {"UBEPOL BR150": {"champion": "SeasonalNaive(m=12)", "wape": 0.2}}

    assert client.get("/api/health").json()["forecast_engine"] == {
        "status": "trained",
        "grades": ["UBEPOL BR150"],
        "trained_at": "2026-11-05T00:00:00+00:00",
    }


def test_failed_retrain_keeps_the_previous_engine(monkeypatch):
    monkeypatch.setattr(forecast, "forecast_engine", STUB_ENGINE)

    def broken():
        raise FileNotFoundError("No billing CSV found")

    monkeypatch.setattr(service, "train_all", broken)

    res = client.post("/api/v1/retrain")
    assert res.status_code == 503
    assert "previous engine kept" in res.json()["detail"]
    assert forecast.forecast_engine is STUB_ENGINE


def test_startup_training_failure_leaves_the_api_unavailable(monkeypatch):
    def broken():
        raise FileNotFoundError("No billing CSV found")

    monkeypatch.setattr(service, "train_all", broken)
    forecast.train_at_startup()

    assert forecast.forecast_engine is None
    assert client.get("/api/v1/models").status_code == 503
