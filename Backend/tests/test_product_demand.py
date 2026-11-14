"""
Demand broken down per product on /optimize (product_demand): the group
demand becomes the sum of its products and the output is shared over them.
Memory mode on the mock product master.
"""

import pytest
from fastapi.testclient import TestClient

import database
import main
from optimization import manual, product_split
from optimization.engine import plant_groups, solve
from optimization.schemas import EvaluateRequest, OptimizeRequest
from planning_data import products

client = TestClient(main.app)
GROUPS = [g["id"] for g in plant_groups()]


@pytest.fixture(autouse=True)
def memory_mode(monkeypatch):
    monkeypatch.setattr(database, "_conn_params", None)
    monkeypatch.setattr(products, "_memory_store", products.MemoryProductStore(products.load_mock_products()))


@pytest.mark.parametrize("total, weights, expected", [
    (230, [900, 300], [173, 57]),       # 172.5 / 57.5: a tie goes to the first product
    (100, [1, 1, 1], [34, 33, 33]),
    (7, [0, 0], [4, 3]),               # no weights: equal shares
    (12.5, [1, 1], [6.3, 6.2]),        # 0.1 t steps when the total is not whole
    (0, [5, 5], [0, 0]),
])
def test_split_keeps_the_exact_sum(total, weights, expected):
    shares = product_split.split(total, weights)
    assert shares == expected
    assert sum(shares) == pytest.approx(total)


def test_prepare_sums_products_into_their_group():
    req = {"demand": {"BR150": 5, "VCR412": 500}, "product_demand": {"990101": 900, "990102": 300}}
    split = product_split.prepare(req, products.load_mock_products(), GROUPS)
    assert req["demand"] == {"BR150": 1200.0, "VCR412": 500}
    assert [i.material_no for i in split.by_group["BR150"]] == ["990101", "990102"]


@pytest.mark.parametrize("material, message", [
    ("123456", "not in the product master"),
    ("990104", "inactive"),
])
def test_prepare_rejects_products_the_plan_cannot_use(material, message):
    with pytest.raises(product_split.ProductDemandError, match=message):
        product_split.prepare({"product_demand": {material: 10}}, products.load_mock_products(), GROUPS)


def test_planning_data_mode_ignores_product_demand():
    req = {"use_planning_data": True, "product_demand": {"990101": 900}, "demand": {"BR150": 1}}
    assert product_split.prepare(req, products.load_mock_products(), GROUPS) is None
    assert req["demand"] == {"BR150": 1}


@pytest.fixture(scope="module")
def solved():
    req = OptimizeRequest(horizon_days=14, time_limit_s=10,
                          product_demand={"990101": 900, "990102": 300, "990501": 400})
    return req, solve(req.model_dump())


def test_solver_shares_each_group_output_over_its_products(solved):
    _, res = solved
    assert res["demand_used"]["BR150"] == 1200 and res["demand_used"]["VCR412"] == 400
    rows = {r["material_no"]: r for r in res["product_fulfillment"]}
    group = {r["grade"]: r for r in res["fulfillment"]}
    assert rows["990101"]["produced"] + rows["990102"]["produced"] == group["BR150"]["produced"]
    assert rows["990501"]["produced"] == group["VCR412"]["produced"]
    # same fulfillment % for every product of a group (whole-ton rounding aside)
    assert rows["990101"]["produced"] / 900 == pytest.approx(rows["990102"]["produced"] / 300, abs=0.02)
    for day in res["days"]:
        broken_down = sum(p["tons"] for p in day["parts"] if p["grade"] in ("BR150", "VCR412"))
        assert sum(p["tons"] for p in day["products"]) == broken_down
    assert any("shared in proportion" in c["text"] for c in res["checks"])


def test_evaluator_shares_the_hand_edited_plan_the_same_way(solved):
    req, res = solved
    draft = manual.draft_from_result(res)
    ev = manual.evaluate(EvaluateRequest(**req.model_dump(), **draft).model_dump())
    assert ev["conflicts"] == 0
    assert {r["material_no"] for r in ev["product_fulfillment"]} == {"990101", "990102", "990501"}
    assert sum(r["produced"] for r in ev["product_fulfillment"] if r["group"] == "BR150") == \
        next(r["produced"] for r in ev["fulfillment"] if r["grade"] == "BR150")


def test_api_rejects_unknown_products_and_non_finite_tons():
    res = client.post("/api/v1/optimize", json={"horizon_days": 7, "product_demand": {"123456": 10}})
    assert res.status_code == 422 and "not in the product master" in res.json()["detail"]
    res = client.post("/api/v1/optimize", content='{"horizon_days": 7, "product_demand": {"990101": NaN}}',
                      headers={"Content-Type": "application/json"})
    assert res.status_code == 422                   # NaN fails ge=0, like any out-of-range tons


def test_api_rejects_negative_tons_with_a_422():
    # a negative value used to reach CP-SAT and crash the model build (HTTP 500)
    res = client.post("/api/v1/optimize", json={"horizon_days": 7, "demand": {"BR150": -5}})
    assert res.status_code == 422
    res = client.post("/api/v1/optimize", json={"horizon_days": 7, "product_demand": {"990101": -1}})
    assert res.status_code == 422
    res = client.post("/api/v1/optimize", json={"horizon_days": 7, "demand": {"BR150": 0}, "time_limit_s": 5})
    assert res.status_code != 422                   # zero tons stays legal


def test_without_product_demand_nothing_changes():
    res = solve(OptimizeRequest(horizon_days=7, time_limit_s=5).model_dump())
    assert "product_fulfillment" not in res and all("products" not in d for d in res["days"])
