import pytest
from fastapi.testclient import TestClient

import main
from conftest import GRADES, N_MONTHS
from forecasting import registry
from forecasting import service as demand_service
from forecasting.price import service as price_service


@pytest.fixture(scope="module")
def client(synthetic_data):
    price_engine = price_service.train_all(synthetic_data["billing"], synthetic_data["bd"])
    demand_engine = demand_service.train_all(synthetic_data["billing"])
    registry.set_engine("price", price_engine)
    registry.set_engine("demand", demand_engine)
    # no context manager: startup events (which would train from DemandModel/) must not run
    yield TestClient(main.app)
    registry.set_engine("price", None)
    registry.set_engine("demand", None)


def test_models_leaderboard(client):
    res = client.get("/api/v1/price/models")
    assert res.status_code == 200
    body = res.json()
    assert {m["product_id"] for m in body["models"]} == set(GRADES)
    assert body["bd_last"] > 0
    for row in body["models"]:
        assert row["champion"] and row["mape"] is not None


def test_history(client):
    res = client.get("/api/v1/price/history", params={"product_id": GRADES[1]})
    assert res.status_code == 200
    body = res.json()
    assert body["product_id"] == GRADES[1]
    assert len(body["months"]) == N_MONTHS
    assert {"period", "fob_price", "net_price", "qty", "bd"} <= set(body["months"][-1])


def test_forecast_with_scenario(client):
    res = client.get("/api/v1/price/forecast", params={"product_id": GRADES[0], "horizon_months": 4, "bd_change_pct": 10})
    assert res.status_code == 200
    body = res.json()
    assert body["product_id"] == GRADES[0]
    assert len(body["forecast"]) == 4 and len(body["lower"]) == 4 and len(body["upper"]) == 4
    assert body["bd_change_pct"] == 10
    assert body["metrics"]["mape"] is not None


def test_forecast_validation(client):
    assert client.get("/api/v1/price/forecast", params={"product_id": "nope"}).status_code == 404
    assert client.get("/api/v1/price/forecast", params={"horizon_months": 12}).status_code == 422


def test_revenue_outlook_is_tons_times_price(client):
    res = client.get("/api/v1/revenue/outlook", params={"horizon_months": 3})
    assert res.status_code == 200
    body = res.json()
    assert len(body["periods"]) == 3
    assert {g["product_id"] for g in body["grades"]} == set(GRADES)
    assert body["skipped"] == []
    for grade in body["grades"]:
        for month in grade["months"]:
            assert month["revenue_usd"] == pytest.approx(month["tons"] * month["price_usd_t"], rel=1e-3)
    grand = sum(t["revenue_usd"] for t in body["totals"])
    assert body["grand_total_revenue_usd"] == pytest.approx(grand, rel=1e-9)


def test_engine_unavailable_returns_503(client):
    saved = registry.get("price")
    registry.set_engine("price", None)
    try:
        assert client.get("/api/v1/price/models").status_code == 503
        assert client.get("/api/v1/revenue/outlook").status_code == 503
    finally:
        registry.set_engine("price", saved)


def test_health_reports_price_engine(client):
    body = client.get("/api/health").json()
    assert body["price_engine"]["status"] == "ready"
