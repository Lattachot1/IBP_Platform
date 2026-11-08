"""Hand-edit evaluator with the planning data: the product split and the
planning section must come back for edited plans too (Phase 5 of the
product-level work - the old rule checker could not split over products).
"""

import pytest

from optimization import manual
from optimization.engine import solve
from optimization.schemas import OptimizeRequest


@pytest.fixture
def solved_and_draft():
    """A feasible planning-mode plan (mock data, in-memory) and its draft."""
    req = OptimizeRequest(horizon_days=14, start_date="2026-11-09", use_planning_data=True)
    solved = solve(req.model_dump())
    assert solved["status"] == "feasible", solved.get("message")
    return req.model_dump(), solved, manual.draft_from_result(solved)


def test_evaluated_plan_carries_the_planning_section(solved_and_draft):
    req, solved, draft = solved_and_draft
    ev = manual.evaluate({**req, **draft})
    assert "planning" in ev and ev["planning"]["products"], "planning section expected"

    solved_materials = {p["material_no"] for p in solved["planning"]["products"]}
    ev_materials = {p["material_no"] for p in ev["planning"]["products"]}
    assert ev_materials == solved_materials

    split_days = [d for d in ev["days"] if d.get("products")]
    assert split_days, "product split expected on producing days"
    for day in split_days:
        assert sum(p["tons"] for p in day["products"]) == sum(p["tons"] for p in day["parts"])


def test_evaluated_orders_and_kpis_shape(solved_and_draft):
    req, _solved, draft = solved_and_draft
    ev = manual.evaluate({**req, **draft})
    kpis = ev["planning"]["kpis"]
    for key in ("orders_in_horizon", "orders_on_time", "orders_late", "orders_not_covered",
                "on_time_pct", "late_ton_days", "below_min_ton_days", "forecast_short_tons"):
        assert key in kpis
    for order in ev["planning"]["orders"]:
        assert {"order_no", "due_date", "ready_date", "status"} <= set(order)
