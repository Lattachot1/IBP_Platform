"""
The forecast engine's monthly forecast feeding dbo.DemandForecasts.

Training needs the client's billing data (never in git), so the engine is
a stub and forecasting.service.forecast returns fixed numbers. Memory mode
with an empty planning store unless a test says otherwise.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def no_engine_cache(tmp_path, monkeypatch):
    """Keep tests away from the real engine cache - training and retrain
    write it, and a stub leaking into it would poison the next startup."""
    monkeypatch.setattr(forecast_api, "_cache_path", lambda: tmp_path / "engine.joblib")

import database
import main
from api import forecast as forecast_api
from forecasting import service
from optimization import planning
from planning_data import engine_forecast, products, store
from planning_data.records import Forecast

client = TestClient(main.app)

GROUPS = ["BR150", "BR150B", "BR360B", "VCR412", "VCR617", "BR150L"]
PERIODS = ["2026-%02d" % m for m in range(9, 13)] + ["2027-%02d" % m for m in range(1, 9)]
STUB_ENGINE = {
    "trained_at": "2026-11-05T00:00:00+00:00",
    "grades": {name: {"id": i, "champion": "SeasonalNaive(m=12)", "wape": 0.2, "mase": 0.9}
               for i, name in ((1, "UBEPOL BR150"), (2, "UBEPOL VCR412"), (3, "UBEPOL BR150GN"))},
    "series": {},
}


def fake_forecast(info, horizon, demand_change_pct=0.0):
    tons = [100.0 * info["id"] + i for i in range(horizon)]
    tons[3] = -4.0                       # December 2026: a model may dip below zero
    return {"periods": PERIODS[:horizon], "forecast_tons": tons}


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setattr(database, "_conn_params", None)
    monkeypatch.setattr(service, "forecast", fake_forecast)
    monkeypatch.setattr(engine_forecast, "_today", lambda: date(2026, 11, 5))
    monkeypatch.setattr(engine_forecast, "_last", {"status": "never"})
    monkeypatch.setattr(products, "_memory_store", products.MemoryProductStore(products.load_mock_products()))
    planning_store = store.MemoryPlanningStore()
    monkeypatch.setattr(store, "_memory_store", planning_store)
    monkeypatch.setattr(forecast_api, "forecast_engine", None)
    return planning_store


def test_grades_map_to_plant_groups():
    assert engine_forecast.group_of_grade("UBEPOL BR150", GROUPS) == "BR150"
    assert engine_forecast.group_of_grade("UBEPOL VCR617", GROUPS) == "VCR617"
    assert engine_forecast.group_of_grade("UBEPOL BR150GN", GROUPS) is None
    assert engine_forecast.group_of_grade("X-200", GROUPS) is None


def test_rows_start_at_the_current_month_and_never_go_negative():
    rows, skipped = engine_forecast.engine_rows(STUB_ENGINE, GROUPS, date(2026, 11, 1))
    assert skipped == ["UBEPOL BR150GN"]
    br150 = [r for r in rows if r.group_code == "BR150"]
    assert [r.forecast_month for r in br150][:3] == [date(2026, 11, 1), date(2026, 12, 1), date(2027, 1, 1)]
    assert len(br150) == 10 and br150[-1].forecast_month == date(2027, 8, 1)
    assert br150[1].tons == 0.0                             # the -4 t month
    assert {r.source for r in rows} == {"engine"}


def test_publish_upserts_engine_rows_and_keeps_manual_ones(setup):
    setup.upsert_forecasts([Forecast(group_code="BR150", forecast_month=date(2026, 12, 1), source="manual", tons=2600)],
                           "Planner A")
    report = engine_forecast.publish(STUB_ENGINE)
    assert (report["status"], report["rows"], report["inserted"], report["updated"]) == ("published", 20, 20, 0)
    assert (report["first_month"], report["last_month"]) == ("2026-11", "2027-08")
    assert report["groups"] == ["BR150", "VCR412"] and report["skipped_grades"] == ["UBEPOL BR150GN"]

    december = setup.forecasts(date(2026, 12, 1), date(2026, 12, 1))
    assert {(f.group_code, f.source, f.updated_by) for f in december} == {
        ("BR150", "manual", "Planner A"), ("BR150", "engine", "forecast engine"), ("VCR412", "engine", "forecast engine")}
    effective = planning._effective_forecasts(december)
    assert effective[("BR150", date(2026, 12, 1))] == (2600, "manual")

    again = engine_forecast.publish(STUB_ENGINE)
    assert (again["inserted"], again["updated"]) == (0, 20)
    assert engine_forecast.last_publish()["status"] == "published"


def test_dry_run_counts_without_writing(setup):
    report = engine_forecast.publish(STUB_ENGINE, dry_run=True)
    assert (report["status"], report["inserted"]) == ("checked", 20)
    assert setup.forecasts() == []
    assert engine_forecast.last_publish() == {"status": "never"}


def test_training_hook_skips_memory_mode(setup):
    engine_forecast.publish_after_training(STUB_ENGINE)
    assert engine_forecast.last_publish()["status"] == "skipped"
    assert setup.forecasts() == []


def test_training_hook_never_raises_when_the_database_is_down(monkeypatch):
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})

    def down():
        raise OSError("connection refused")

    monkeypatch.setattr(database, "open_connection", down)
    engine_forecast.publish_after_training(STUB_ENGINE)
    last = engine_forecast.last_publish()
    assert last["status"] == "failed" and "unreachable" in last["error"]


# ----------------------------------------------------------------------------
# API
# ----------------------------------------------------------------------------
def test_publish_endpoint_needs_a_trained_engine():
    assert client.post("/api/v1/forecasts/from-engine").status_code == 503


def test_publish_endpoint_writes_the_forecast(monkeypatch):
    monkeypatch.setattr(forecast_api, "forecast_engine", STUB_ENGINE)
    res = client.post("/api/v1/forecasts/from-engine?dry_run=true")
    assert res.status_code == 200 and res.json()["inserted"] == 20
    assert client.get("/api/v1/forecasts").json() == []

    res = client.post("/api/v1/forecasts/from-engine")
    assert res.status_code == 200 and res.json()["status"] == "published"
    rows = client.get("/api/v1/forecasts?month_from=2026-11-01&month_to=2026-11-01").json()
    assert [(f["group_code"], f["tons"], f["updated_by"]) for f in rows] == [
        ("BR150", 102.0, "forecast engine"), ("VCR412", 202.0, "forecast engine")]
    assert client.get("/api/health").json()["forecast_publish"]["rows"] == 20


def test_publish_endpoint_reports_a_database_outage(monkeypatch):
    monkeypatch.setattr(forecast_api, "forecast_engine", STUB_ENGINE)
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})

    def down():
        raise OSError("connection refused")

    monkeypatch.setattr(database, "open_connection", down)
    res = client.post("/api/v1/forecasts/from-engine")
    assert res.status_code == 503 and "NOT published" in res.json()["detail"]


def test_retrain_publishes_and_reports_it(monkeypatch):
    monkeypatch.setattr(service, "train_all", lambda: STUB_ENGINE)
    body = client.post("/api/v1/retrain").json()
    assert body["published"]["status"] == "skipped"      # memory mode keeps the mock set


def test_startup_training_publishes_in_database_mode(monkeypatch):
    monkeypatch.setattr(service, "train_all", lambda: STUB_ENGINE)
    monkeypatch.setattr(database, "is_configured", lambda: True)
    calls = []
    monkeypatch.setattr(engine_forecast, "publish", lambda engine, **kw: calls.append(engine) or {
        "rows": 0, "first_month": None, "last_month": None})
    forecast_api.train_at_startup(background=False)
    assert calls == [STUB_ENGINE]


def test_failed_startup_training_publishes_nothing(monkeypatch):
    def broken():
        raise FileNotFoundError("No billing CSV found")

    monkeypatch.setattr(service, "train_all", broken)
    monkeypatch.setattr(forecast_api, "_training", {"state": "idle", "started_at": None, "error": None})
    forecast_api.train_at_startup(background=False)
    assert engine_forecast.last_publish() == {"status": "never"}
