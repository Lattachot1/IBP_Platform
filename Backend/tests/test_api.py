"""
API tests: What-if simulation, scenario store and request validation.

The TestClient is used without a `with` block on purpose: that skips the
startup hook, so no database connection is attempted and the forecast
engine (which needs the client's billing data, never in git) is not
trained. The app runs in in-memory mode with the forecast engine
unavailable - the same state CI sees.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


# ----------------------------------------------------------------------------
# What-if simulation (the three Capstone presets)
# ----------------------------------------------------------------------------
@pytest.mark.parametrize(
    "payload, expected",
    [
        (
            {"base_demand": 10000, "demand_change_pct": 0, "enable_ot": False},
            {
                "forecast_demand": 10000, "lower_bound": 9500, "upper_bound": 10500,
                "capacity_limit": 10500, "actual_produce": 10000, "shortage_qty": 0,
                "service_level_pct": 100, "revenue_thb": 10_000_000, "extra_cost_thb": 0,
                "constraint_status": "Feasible / Normal Capacity",
            },
        ),
        (
            {"base_demand": 10000, "demand_change_pct": 20, "enable_ot": False},
            {
                "forecast_demand": 12000, "lower_bound": 11400, "upper_bound": 12600,
                "capacity_limit": 10500, "actual_produce": 10500, "shortage_qty": 1500,
                "service_level_pct": 87.5, "revenue_thb": 10_500_000, "extra_cost_thb": 0,
                "constraint_status": "Capacity Overload Bottleneck (Shortage: 1500 units)",
            },
        ),
        (
            {"base_demand": 10000, "demand_change_pct": 20, "enable_ot": True},
            {
                "forecast_demand": 12000, "lower_bound": 11400, "upper_bound": 12600,
                "capacity_limit": 12000, "actual_produce": 12000, "shortage_qty": 0,
                "service_level_pct": 100, "revenue_thb": 12_000_000, "extra_cost_thb": 120_000,
                "constraint_status": "Feasible (Overtime Shift Activated)",
            },
        ),
    ],
    ids=["base", "surge", "surge-with-ot"],
)
def test_simulate_capstone_presets(payload, expected):
    res = client.post("/api/simulate", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert {key: body[key] for key in expected} == expected


def test_simulate_fills_defaults():
    body = client.post("/api/simulate", json={}).json()
    assert body["scenario_name"] == "What-If Simulation"
    assert body["base_demand"] == 10000
    assert body["created_by"] == "Planner (Interactive)"


def test_simulate_full_demand_drop_produces_nothing():
    body = client.post("/api/simulate", json={"base_demand": 10000, "demand_change_pct": -100}).json()
    assert body["forecast_demand"] == 0
    assert body["actual_produce"] == 0
    assert body["service_level_pct"] == 100


@pytest.mark.parametrize(
    "payload",
    [
        {"base_demand": 0},
        {"base_demand": -5000},
        {"base_demand": 2_000_000},
        {"demand_change_pct": -101},
        {"demand_change_pct": 501},
        {"scenario_name": "x" * 101},   # dbo.Scenarios.ScenarioName is NVARCHAR(100)
        {"created_by": "x" * 51},       # dbo.Scenarios.CreatedBy is NVARCHAR(50)
    ],
    ids=["zero-demand", "negative-demand", "huge-demand", "pct-below", "pct-above",
         "long-name", "long-created-by"],
)
@pytest.mark.parametrize("path", ["/api/simulate", "/api/scenarios/save"])
def test_rejects_out_of_range_inputs(path, payload):
    res = client.post(path, json=payload)
    assert res.status_code == 422
    field = next(iter(payload))
    assert any(field in issue["loc"] for issue in res.json()["detail"])


@pytest.mark.parametrize("raw", ["NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize("path", ["/api/simulate", "/api/scenarios/save"])
def test_rejects_non_finite_numbers(path, raw):
    # json.dumps cannot emit NaN under httpx, so send the raw body. The 422
    # echoes the input, which must not crash the JSON encoder (-> 500).
    res = client.post(
        path,
        content='{"base_demand": %s}' % raw,
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"] == ["body", "base_demand"]


# ----------------------------------------------------------------------------
# Scenario store
# ----------------------------------------------------------------------------
def test_saved_scenario_is_listed_first():
    scenario = client.post("/api/simulate", json={"demand_change_pct": 10}).json()
    scenario["scenario_name"] = "pytest round trip"

    res = client.post("/api/scenarios/save", json=scenario)
    assert res.status_code == 201
    saved = res.json()
    assert saved["scenario_id"] > 0

    listed = client.get("/api/scenarios").json()
    assert listed[0]["scenario_id"] == saved["scenario_id"]
    assert listed[0]["scenario_name"] == "pytest round trip"


def test_save_recomputes_figures_sent_by_the_client():
    tampered = {
        "scenario_name": "tampered",
        "base_demand": 10000,
        "demand_change_pct": 20,
        "enable_ot": False,
        # results a client must not be able to plant in the audit trail
        "revenue_thb": 999_999_999,
        "service_level_pct": 100,
        "shortage_qty": 0,
        "scenario_id": 1,
    }
    saved = client.post("/api/scenarios/save", json=tampered).json()
    assert saved["revenue_thb"] == 10_500_000
    assert saved["service_level_pct"] == 87.5
    assert saved["shortage_qty"] == 1500
    assert saved["scenario_id"] != 1


class _DatabaseDown(Exception):
    pass


def _raise_down(*_args, **_kwargs):
    raise _DatabaseDown("connection refused")


@pytest.fixture
def database_mode(monkeypatch):
    """Pretend a database is configured; tests patch the DB calls."""
    monkeypatch.setattr(main.database, "is_configured", lambda: True)
    return monkeypatch


def test_failed_insert_is_503_and_not_kept_in_memory(database_mode):
    database_mode.setattr(main.database, "insert_scenario", _raise_down)
    before = len(main.store.recent(1000))

    res = client.post("/api/scenarios/save", json={"scenario_name": "lost?"})
    assert res.status_code == 503
    assert "NOT saved" in res.json()["detail"]
    assert len(main.store.recent(1000)) == before


def test_insert_stores_recomputed_values(database_mode):
    inserted = {}

    def fake_insert(values):
        inserted.update(values)
        return 42, datetime(2026, 11, 5, tzinfo=timezone.utc)

    database_mode.setattr(main.database, "insert_scenario", fake_insert)
    res = client.post("/api/scenarios/save", json={"demand_change_pct": 20, "revenue_thb": 1})
    assert res.status_code == 201
    assert res.json()["scenario_id"] == 42
    assert inserted["revenue_thb"] == 10_500_000


def test_failed_query_is_503_not_memory_seeds(database_mode):
    database_mode.setattr(main.database, "fetch_top_scenarios", _raise_down)
    res = client.get("/api/scenarios")
    assert res.status_code == 503


def test_empty_database_lists_nothing(database_mode):
    database_mode.setattr(main.database, "fetch_top_scenarios", lambda limit: [])
    assert client.get("/api/scenarios").json() == []


# ----------------------------------------------------------------------------
# Service state and validation
# ----------------------------------------------------------------------------
def test_health_without_database_or_engine():
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["database"] == "In-Memory Mode (Active)"
    assert body["storage"] == "memory"
    assert body["forecast_engine"] == {"status": "unavailable"}


@pytest.mark.parametrize("path", ["/api/v1/models", "/api/v1/history", "/api/v1/forecast"])
def test_forecast_api_is_unavailable_without_engine(path):
    assert client.get(path).status_code == 503


@pytest.mark.parametrize(
    "payload",
    [{"horizon_days": 3}, {"horizon_days": 500}, {"time_limit_s": 1}],
    ids=["horizon-too-short", "horizon-too-long", "time-limit-too-short"],
)
def test_optimize_rejects_out_of_range_scope(payload):
    assert client.post("/api/v1/optimize", json=payload).status_code == 422


def test_evaluate_rejects_campaigns_that_do_not_fill_the_horizon():
    res = client.post(
        "/api/v1/optimize/evaluate",
        json={"horizon_days": 14, "campaigns": [{"grade": "BR150", "days": 10}]},
    )
    assert res.status_code == 400
    assert "horizon" in res.json()["detail"]
