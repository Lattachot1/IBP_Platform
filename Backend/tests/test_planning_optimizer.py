"""
Product-level planning (use_planning_data): inputs built from the planning
data, the requirement tiers in CP-SAT, and the planning report.

build_inputs is a pure function and is tested on hand-made records. The
solver tests replace load_inputs with such inputs, so each case states its
own stock, lots, orders and forecast. Every plant rule still applies.
"""

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

import database
import main
from optimization import engine, planning
from optimization.schemas import OptimizeRequest
from planning_data import products, store
from planning_data.records import Forecast, QcLot, SalesOrder, StockAdjustment, StockRow, StockSnapshot

client = TestClient(main.app)
GROUPS = ["BR150", "BR150B", "BR360B", "VCR412", "VCR617", "BR150L"]
START = date(2026, 11, 9)          # a Monday
NOW = datetime(2026, 11, 5, tzinfo=timezone.utc)


def product(material, group="BR150", minimum=0.0, active=True):
    return products.Product(material_no=material, description=material, group_code=group,
                            min_stock_tons=minimum, is_active=active, updated_at=NOW, updated_by="test")


def order(no, material, tons, due, shipped=0.0, status="open"):
    return SalesOrder(order_no=no, item_no=10, material_no=material, tons=tons, shipped_tons=shipped,
                      due_date=due, status=status)


def snapshot(day, **stock):
    return StockSnapshot(snapshot_date=day, rows=[StockRow(material_no=m, on_hand_tons=t) for m, t in stock.items()])


def build(products_=(), snap=None, lots=(), orders=(), forecasts=(), horizon=28, qc_days=5):
    return planning.build_inputs(GROUPS, list(products_), snap or StockSnapshot(), list(lots), list(orders),
                                 list(forecasts), START, horizon, qc_days)


# ----------------------------------------------------------------------------
# build_inputs
# ----------------------------------------------------------------------------
def test_orders_overdue_count_on_day_zero_and_late_ones_stay_out_of_the_horizon():
    inputs = build([product("A")], snapshot(START, A=0), orders=[
        order("1", "A", 50, date(2026, 11, 5), shipped=20),     # overdue, 30 t still open
        order("2", "A", 40, date(2026, 11, 12)),
        order("3", "A", 99, date(2027, 1, 20)),                 # beyond a 28-day horizon
        order("4", "A", 70, date(2026, 11, 12), status="cancelled"),
        order("5", "A", 80, date(2026, 11, 3), shipped=80, status="closed"),
    ])
    assert inputs.products[0].demand == {0: 30.0, 3: 40.0}
    assert [(o.order_no, o.due_index) for o in inputs.orders] == [("1", 0), ("2", 3), ("3", 72)]


def test_qc_lots_still_in_qc_or_released_after_the_snapshot_count():
    lots = [
        QcLot(lot_no="1", material_no="A", tons=10, produced_date=date(2026, 11, 4), release_date=date(2026, 11, 9), status="in_qc"),
        QcLot(lot_no="2", material_no="A", tons=20, produced_date=date(2026, 10, 30), release_date=date(2026, 11, 4), status="in_qc"),   # QC running late
        QcLot(lot_no="3", material_no="A", tons=30, produced_date=date(2026, 11, 2), release_date=date(2026, 11, 7), status="released"),  # after the snapshot
        QcLot(lot_no="4", material_no="A", tons=40, produced_date=date(2026, 10, 30), release_date=date(2026, 11, 5), status="released"),  # in the snapshot
        QcLot(lot_no="5", material_no="A", tons=50, produced_date=date(2026, 11, 4), release_date=date(2026, 11, 11), status="rejected"),
        QcLot(lot_no="6", material_no="A", tons=60, produced_date=date(2026, 11, 6), release_date=date(2026, 11, 11), status="in_qc"),
    ]
    inputs = build([product("A")], snapshot(date(2026, 11, 6), A=100), lots=lots)
    assert inputs.products[0].start_stock == 100
    assert inputs.products[0].receipts == {0: 60.0, 2: 60.0}


def test_hand_stock_adjustments_win_over_the_snapshot_value():
    snap = snapshot(START, A=40, B=10)
    snap.adjustments = [StockAdjustment(material_no="A", adjust_tons=55)]
    inputs = build([product("A"), product("B")], snap)
    assert inputs.products[0].start_stock == 55                 # the adjustment wins
    assert inputs.products[1].start_stock == 10                 # the others keep the import
    assert any("1 materials use hand-entered stock instead of the snapshot" in w for w in inputs.warnings)


def test_hand_stock_adjustments_stand_alone_without_a_snapshot():
    snap = StockSnapshot(adjustments=[StockAdjustment(material_no="A", adjust_tons=55)])
    inputs = build([product("A")], snap)
    assert inputs.products[0].start_stock == 55
    assert any("No stock snapshot" in w and "hand-entered" in w for w in inputs.warnings)


def test_an_adjustment_for_an_unknown_product_is_ignored():
    snap = StockSnapshot(adjustments=[StockAdjustment(material_no="ZZ", adjust_tons=55)])
    inputs = build([product("A")], snap)
    assert inputs.products[0].start_stock == 0
    assert not any("hand-entered" in w for w in inputs.warnings)


def test_forecast_consumed_by_orders_manual_overrides_engine_and_last_month_prorated():
    forecasts = [
        Forecast(group_code="BR150", forecast_month=date(2026, 11, 1), source="engine", tons=1000),
        Forecast(group_code="BR150", forecast_month=date(2026, 11, 1), source="manual", tons=1200),
        Forecast(group_code="BR150", forecast_month=date(2026, 12, 1), source="engine", tons=620),
        Forecast(group_code="BR150L", forecast_month=date(2026, 11, 1), source="engine", tons=100),
    ]
    orders = [
        order("1", "A", 300, date(2026, 11, 3), shipped=300, status="closed"),   # shipped earlier this month
        order("2", "A", 100, date(2026, 11, 20)),
        order("3", "L", 150, date(2026, 11, 20)),                               # more than the forecast
    ]
    inputs = build([product("A"), product("L", "BR150L")], snapshot(START), orders=orders, forecasts=forecasts)
    months = {(mi.group, mi.month.month): mi for mi in inputs.months}
    nov, dec, l_nov = months[("BR150", 11)], months[("BR150", 12)], months[("BR150L", 11)]
    assert (nov.forecast, nov.source, nov.ordered, nov.remainder, nov.fraction) == (1200, "manual", 400, 800, 1.0)
    assert nov.deadline == 21                                   # 30 Nov
    assert dec.deadline == 27 and dec.fraction == pytest.approx(6 / 31)
    assert l_nov.remainder == 0
    a = inputs.products[0]
    assert a.expected == {21: 800, 27: pytest.approx(620 * 6 / 31)}
    assert a.lookahead == pytest.approx(620 * 25 / 31)


def test_horizon_ending_on_a_month_end_looks_ahead_to_the_next_month():
    forecasts = [Forecast(group_code="BR150", forecast_month=date(2026, 11, 1), source="engine", tons=500),
                 Forecast(group_code="BR150", forecast_month=date(2026, 12, 1), source="engine", tons=700)]
    inputs = build([product("A")], snapshot(START), forecasts=forecasts, horizon=22)    # 9..30 Nov
    assert inputs.products[0].expected == {21: 500}
    assert inputs.products[0].lookahead == 700


def test_shares_follow_order_tons_or_split_equally():
    orders = [order("1", "A", 300, date(2026, 11, 20)), order("2", "B", 100, date(2026, 11, 20))]
    inputs = build([product("A"), product("B"), product("V1", "VCR412"), product("V2", "VCR412")],
                   snapshot(START), orders=orders)
    shares = {p.material_no: p.share for p in inputs.products}
    assert shares == {"A": 0.75, "B": 0.25, "V1": 0.5, "V2": 0.5}


def test_input_warnings():
    inputs = build([product("A"), product("OLD", "BR777"), product("GONE", active=False)],
                   snapshot(date(2026, 10, 20), A=1),
                   orders=[order("1", "GONE", 10, date(2026, 11, 20))])
    text = " | ".join(inputs.warnings)
    assert "group not in plant_config.yaml): OLD" in text
    assert "Inactive product GONE still has open orders" in text
    assert "20 days old" in text
    assert "No stock snapshot" in " ".join(build([product("A")]).warnings)


def test_fifo_ready_days():
    supply = [(0, 100.0), (6, 50.0), (9, 200.0)]
    assert planning._fifo_ready([60, 40, 30, 100, 500], supply) == [0, 0, 6, 9, None]


# ----------------------------------------------------------------------------
# solver
# ----------------------------------------------------------------------------
def solve_with(monkeypatch, inputs, **request):
    monkeypatch.setattr(planning, "load_inputs", lambda *args, **kwargs: inputs)
    req = OptimizeRequest(start_date=START.isoformat(), use_planning_data=True, time_limit_s=20, **request)
    res = engine.solve(req.model_dump())
    assert res["status"] == "feasible", res.get("message")
    return res


def _orders(res):
    return {o["order_no"]: o for o in res["planning"]["orders"]}


def test_output_is_split_over_products_and_orders_are_served(monkeypatch):
    inputs = build([product("A"), product("B")], snapshot(START, A=0, B=0),
                   orders=[order("1", "A", 400, date(2026, 11, 17))], horizon=14)
    res = solve_with(monkeypatch, inputs, horizon_days=14)
    for day in res["days"]:                     # only BR150 has products here
        br150 = sum(p["tons"] for p in day["parts"] if p["grade"] == "BR150")
        assert sum(p["tons"] for p in day["products"]) == br150
    others = sum(p["tons"] for d in res["days"] for p in d["parts"] if p["grade"] != "BR150")
    assert sum(res["planning"]["unallocated_tons"].values()) == others
    if others:
        assert any("no products" in c["text"] for c in res["checks"])
    assert _orders(res)["1"]["status"] == "on_time"
    a = next(p for p in res["planning"]["products"] if p["material_no"] == "A")
    assert sum(a["produced"][:4]) >= 400            # produced by 12 Nov, in stock after 5 days of QC


def test_orders_come_before_the_forecast(monkeypatch):
    # Days 0-1 must stay BR150 (initial state). Order 1 needs 460 t ready by
    # 16 Nov (day 7 = qc_days after day 2), so days 0-2 of production must
    # cover it - even where the forecast tier takes a few tons for B too,
    # which may shave a day's BR150 output without making the order late.
    forecasts = [Forecast(group_code="BR150", forecast_month=date(2026, 11, 1), source="engine", tons=5000)]
    orders = [order("1", "A", 460, date(2026, 11, 16)), order("0", "B", 1, date(2026, 11, 30))]
    inputs = build([product("A"), product("B")], snapshot(START, A=0, B=1), orders=orders,
                   forecasts=forecasts, horizon=14)
    res = solve_with(monkeypatch, inputs, horizon_days=14)
    assert _orders(res)["1"]["status"] == "on_time"
    a = next(p for p in res["planning"]["products"] if p["material_no"] == "A")
    assert sum(a["produced"][:3]) >= 460


def test_unavoidable_lateness_is_reported(monkeypatch):
    # Nothing in stock or QC and the order is due before any output can pass QC
    inputs = build([product("A")], snapshot(START, A=0), orders=[order("1", "A", 50, date(2026, 11, 10))], horizon=14)
    res = solve_with(monkeypatch, inputs, horizon_days=14)
    o = _orders(res)["1"]
    assert o["status"] == "late" and o["late_days"] >= 4
    assert any("orders not on time" in c["text"] for c in res["checks"])


def test_minimum_stock_is_refilled(monkeypatch):
    inputs = build([product("A", minimum=300), product("B")], snapshot(START, A=0, B=0), horizon=14)
    res = solve_with(monkeypatch, inputs, horizon_days=14)
    a = next(p for p in res["planning"]["products"] if p["material_no"] == "A")
    assert a["end_stock"] >= 300
    assert a["days_below_min"] <= 6                 # only until the first output clears QC


def test_attach_free_counts_ready_output_against_below_min():
    # 100 t made on day 0 clears QC on day 5. The 50 t order due day 1 dips
    # the stock to -50, so day 5 sits 50 t below the 100 t minimum - not 100 t:
    # the ready output already refills it. This must match the CP-SAT
    # constraint `below >= gap - sum(ready) - late`, i.e. solve == evaluate.
    inputs = build([product("A", minimum=100)], snapshot(START, A=0),
                   orders=[order("1", "A", 50, date(2026, 11, 10))], horizon=14)
    prod = [{0: 100 if d == 0 else 0} for d in range(14)]   # grade-index keyed, every day
    pm = planning.attach_free(inputs, prod, ["BR150"], {"BR150": 500})
    below_by_day = dict(pm.products[0].below_min)
    assert below_by_day[1] == 100                   # nothing out of QC yet
    assert below_by_day[5] == 50 and below_by_day[6] == 50


def test_report_carries_requirement_and_shortage_per_product(monkeypatch):
    # requirement = orders due in the horizon + minimum stock + forecast share
    # - starting stock - lots in QC; shortage = the part the plan cannot produce
    forecasts = [Forecast(group_code="BR150", forecast_month=date(2026, 11, 1), source="engine", tons=3000)]
    inputs = build([product("A", minimum=100), product("B")], snapshot(START, A=200, B=0),
                   orders=[order("1", "A", 400, date(2026, 11, 17))], forecasts=forecasts, horizon=14)
    res = solve_with(monkeypatch, inputs, horizon_days=14)
    rows = {p["material_no"]: p for p in res["planning"]["products"]}
    assert rows["A"]["requirement"] >= 400 + 100 - 200      # order + minimum - starting stock
    assert rows["B"]["requirement"] == 0 and rows["B"]["shortage"] == 0
    for p in rows.values():
        made = sum(p["produced"])
        assert p["shortage"] == round(max(0.0, p["requirement"] - made), 1)
    # the group's demand in the fulfillment table is the sum of its products'
    # requirements, up to per-product rounding (the solver takes whole tons,
    # the report shows 0.1 t)
    assert res["demand_used"]["BR150"] == pytest.approx(
        sum(p["requirement"] for p in rows.values()), abs=0.5 * len(rows))


def test_without_the_flag_the_response_is_unchanged(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("planning data must not be read")

    monkeypatch.setattr(planning, "load_inputs", boom)
    res = engine.solve(OptimizeRequest(horizon_days=7, time_limit_s=5).model_dump())
    assert "planning" not in res and all("products" not in d for d in res["days"])


# ----------------------------------------------------------------------------
# API, memory mode on the mock data
# ----------------------------------------------------------------------------
@pytest.fixture
def mock_memory(monkeypatch):
    monkeypatch.setattr(database, "_conn_params", None)
    monkeypatch.setattr(products, "_memory_store", None)
    monkeypatch.setattr(store, "_memory_store", None)


def test_optimize_with_planning_data_on_the_mock_set(mock_memory):
    res = client.post("/api/v1/optimize", json={
        "start_date": "2026-11-09", "horizon_days": 28, "use_planning_data": True, "time_limit_s": 30})
    assert res.status_code == 200
    body = res.json()
    plan = body["planning"]
    assert plan["snapshot_date"] == "2026-11-06" and plan["qc_days"] == 5
    assert plan["kpis"]["orders_in_horizon"] > 0
    assert {p["material_no"] for p in plan["products"]} >= {"990101", "990401", "990602"}
    assert "990104" not in {p["material_no"] for p in plan["products"]}          # inactive, no open orders
    overdue = next(o for o in plan["orders"] if o["due_date"] == "2026-11-05")
    assert overdue["status"] == "late"
    for day in body["days"]:
        assert sum(p["tons"] for p in day["products"]) == sum(p["tons"] for p in day["parts"])
    assert all("requirement" in p and "shortage" in p for p in plan["products"])


def test_optimize_with_planning_data_needs_the_database(monkeypatch):
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})

    def down():
        raise OSError("connection refused")

    monkeypatch.setattr(database, "open_connection", down)
    res = client.post("/api/v1/optimize", json={"use_planning_data": True, "horizon_days": 7})
    assert res.status_code == 503


def test_every_assumption_in_plant_config_is_plain_text():
    # an unquoted "key: value" inside a list item becomes a mapping in YAML
    # and crashed the /optimize page's assumptions panel
    assumptions = engine._load_config()["assumptions"]
    assert assumptions and all(isinstance(a, str) for a in assumptions), assumptions
