import pytest
from fastapi.testclient import TestClient

import main
from conftest import GRADES, N_MONTHS
from forecasting import registry
from forecasting import service as demand_service
from forecasting.price import service as price_service
from forecasting.rawmat import models as rawmat_models
from forecasting.rawmat import service as rawmat_service

BASE = "/api/v1/raw-material-price"


@pytest.fixture(scope="module")
def client(synthetic_data):
    rawmat_engine = rawmat_service.train_all(synthetic_data["bd"])
    rawmat_engine["engine_source"] = "trained"
    price_engine = price_service.train_all(synthetic_data["billing"], synthetic_data["bd"])
    demand_engine = demand_service.train_all(synthetic_data["billing"])
    registry.set_engine("rawmat", rawmat_engine)
    registry.set_engine("price", price_engine)
    registry.set_engine("demand", demand_engine)
    yield TestClient(main.app)
    registry.set_engine("rawmat", None)
    registry.set_engine("price", None)
    registry.set_engine("demand", None)


def test_get_and_post_forecast_share_one_contract(client):
    got = client.get(f"{BASE}/forecast", params={"horizon_months": 3})
    assert got.status_code == 200
    body = got.json()
    assert body["symbol"] == "PA0033242"
    assert len(body["forecasts"]) == 3
    assert {"artifact_version", "forecast_origin", "model_name", "validation_mae", "readiness",
            "scenario_interpretation"} <= set(body)

    posted = client.post(f"{BASE}/forecast", json={"symbol": "PA0033242", "horizon_months": 2})
    assert posted.status_code == 200
    assert len(posted.json()["forecasts"]) == 2
    assert posted.json()["forecasts"][-1]["horizon"] == 2


def test_forecast_validation(client):
    assert client.get(f"{BASE}/forecast", params={"symbol": "UNKNOWN"}).status_code == 404
    assert client.get(f"{BASE}/forecast", params={"horizon_months": 7}).status_code == 422
    assert client.post(f"{BASE}/forecast", json={"horizon_months": 0}).status_code == 422


def test_models_and_history(client):
    body = client.get(f"{BASE}/models").json()
    assert len(body["models"]) == len(rawmat_models.MODEL_NAMES)
    assert sum(1 for m in body["models"] if m["champion"]) == 1
    assert all(m["mae_h4"] is not None for m in body["models"])
    hist = client.get(f"{BASE}/history").json()
    assert len(hist["months"]) == N_MONTHS


def test_price_forecast_chains_the_bd_scenarios(client):
    def fetch(scenario):
        res = client.get("/api/v1/price/forecast", params={
            "product_id": GRADES[0], "horizon_months": 4, "bd_scenario": scenario,
        })
        assert res.status_code == 200, res.text
        return res.json()

    low, base, high, flat = fetch("low"), fetch("base"), fetch("high"), fetch("flat")
    rawmat_engine = registry.get("rawmat")
    assert high["bd_path"] == rawmat_service.scenario_path(rawmat_engine, "high", 4)
    assert high["bd_source"].startswith("butadiene forecast P90")
    assert flat["bd_scenario"] == "flat" and flat["bd_source"].startswith("last BD held flat")
    # month 1 always uses the last known BD; the scenario acts from month 2
    assert low["forecast"][0] == pytest.approx(high["forecast"][0])
    assert low["forecast"][1] <= base["forecast"][1] <= high["forecast"][1]
    assert high["forecast"][3] > low["forecast"][3]
    assert client.get("/api/v1/price/forecast", params={"bd_scenario": "weird"}).status_code == 400


def test_revenue_outlook_chains_the_bd_scenarios(client):
    low = client.get("/api/v1/revenue/outlook", params={"horizon_months": 3, "bd_scenario": "low"}).json()
    high = client.get("/api/v1/revenue/outlook", params={"horizon_months": 3, "bd_scenario": "high"}).json()
    assert low["bd_scenario"] == "low" and high["bd_scenario"] == "high"
    assert high["grand_total_revenue_usd"] > low["grand_total_revenue_usd"]


def test_scenarios_need_the_rawmat_engine(client):
    saved = registry.get("rawmat")
    registry.set_engine("rawmat", None)
    try:
        assert client.get("/api/v1/price/forecast", params={"bd_scenario": "base"}).status_code == 503
        assert client.get("/api/v1/price/forecast", params={"bd_scenario": "flat"}).status_code == 200
        assert client.get(f"{BASE}/forecast").status_code == 503
    finally:
        registry.set_engine("rawmat", saved)


def test_health_reports_rawmat_engine(client):
    body = client.get("/api/health").json()
    assert body["rawmat_engine"]["status"] == "ready"
    assert body["rawmat_engine"]["source"] == "trained"
