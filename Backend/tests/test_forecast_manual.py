"""Hand-set forecasts: PUT overrides the engine's and the Sale forecast's
number, DELETE clears it, and the floor rule holds - never below the
month's actual order tons. Orders keep their due dates and their own
tier; the part of the hand-set forecast above them is demand without a
due date, to be produced within the month.

Memory mode, mock products, empty planning store (like the import tests).
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient

import database
import main
from planning_data import products, store
from planning_data.records import Forecast

client = TestClient(main.app)

ORDER_HEADER = ("Sales Order Number,Sales Order Item,Material Number,Mat Description,Sold-to Code,Plant,"
                "Order Qty,Delivered Qty,SU,Req. Delivery Date,Status\n")


@pytest.fixture(autouse=True)
def memory_mode(monkeypatch):
    """Memory mode: mock products, empty planning tables."""
    monkeypatch.setattr(database, "_conn_params", None)
    monkeypatch.setattr(products, "_memory_store", products.MemoryProductStore(products.load_mock_products()))
    planning = store.MemoryPlanningStore()
    monkeypatch.setattr(store, "_memory_store", planning)
    return planning


def seed_orders(*rows):
    res = client.post("/api/v1/imports/sales-orders", content=(ORDER_HEADER + "".join(rows)).encode("utf-8"),
                      headers={"Content-Type": "text/csv"})
    assert res.status_code == 200, res.text


def seed_engine(group, month, tons):
    store.memory_store().upsert_forecasts(
        [Forecast(group_code=group, forecast_month=date(2026, month, 1), source="engine", tons=tons)],
        "forecast engine")


def grid(**params):
    return client.get("/api/v1/forecast-grid", params=params)


def br150_cells(body):
    return [(c["tons"], c["source"]) for c in body if c["group_code"] == "BR150"]


def test_set_forecast_overrides_the_engine(memory_mode):
    seed_engine("BR150", 11, 2000.0)
    res = client.put("/api/v1/forecasts/BR150/2026-11", json={"tons": 2600})
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["group_code"], body["source"], body["tons"]) == ("BR150", "manual", 2600)
    # the engine row stays underneath; the grid shows the manual value
    assert len(client.get("/api/v1/forecasts").json()) == 2
    assert br150_cells(grid(start_month="2026-11", months=1).json()) == [(2600.0, "manual")]


def test_floor_blocks_a_set_below_the_months_orders(memory_mode):
    # ordered counts the order's full tons, not just the open part
    seed_orders("9100000001,10,990101,x,1,9001,500,100,TO,2026/11/15,Open\n")
    too_low = client.put("/api/v1/forecasts/BR150/2026-11", json={"tons": 499.9})
    assert too_low.status_code == 422
    assert "500" in too_low.json()["detail"]
    assert client.put("/api/v1/forecasts/BR150/2026-11", json={"tons": 500}).status_code == 200


def test_floor_is_orders_of_that_group_and_month_only(memory_mode):
    seed_orders(
        "9100000002,10,990101,x,1,9001,999,0,TO,2026/12/20,Open\n",      # another month: not November's floor
        "9100000003,10,990101,x,1,9001,300,0,TO,2026/11/25,Cancelled\n",  # cancelled: never counted
        "9100000004,10,990104,x,1,9001,120,0,TO,2026/11/05,Open\n",       # inactive product, BR150 all the same
    )
    assert client.put("/api/v1/forecasts/BR150/2026-11", json={"tons": 125}).status_code == 200
    assert client.put("/api/v1/forecasts/BR150/2026-11", json={"tons": 119}).status_code == 422
    # another group's orders are not BR150's floor
    seed_orders("9100000005,10,990501,x,1,9001,9999,0,TO,2026/11/20,Open\n")
    assert client.put("/api/v1/forecasts/BR150/2026-11", json={"tons": 125}).status_code == 200


def test_clear_reverts_to_engine(memory_mode):
    seed_engine("BR150", 11, 2000.0)
    client.put("/api/v1/forecasts/BR150/2026-11", json={"tons": 2600})
    cleared = client.delete("/api/v1/forecasts/BR150/2026-11/manual")
    assert cleared.status_code == 200
    assert cleared.json() == {"deleted": 1}
    assert br150_cells(grid(start_month="2026-11", months=1).json()) == [(2000.0, "engine")]
    assert client.delete("/api/v1/forecasts/BR150/2026-11/manual").json() == {"deleted": 0}


def test_grid_covers_plant_groups_and_months(memory_mode):
    seed_engine("VCR412", 12, 700.0)
    body = grid(start_month="2026-11", months=2).json()
    cells = {(c["group_code"], c["month"]): c for c in body}
    assert len({c["group_code"] for c in body}) == 7        # every plant group, BR150LGN included, empty or not
    assert cells[("VCR412", "2026-12-01")]["tons"] == 700.0
    assert cells[("BR150LGN", "2026-11-01")]["tons"] is None
    assert cells[("VCR412", "2026-12-01")]["ordered_tons"] == 0.0


def test_bad_inputs_are_rejected(memory_mode):
    assert client.put("/api/v1/forecasts/BR150/2026-1", json={"tons": 10}).status_code == 422
    assert client.put("/api/v1/forecasts/NOPE/2026-11", json={"tons": 10}).status_code == 422
    assert client.put("/api/v1/forecasts/BR150/2026-11", json={"tons": -1}).status_code == 422
    assert grid(start_month="2026-13", months=2).status_code == 422
    assert grid(start_month="2026-11", months=0).status_code == 422
