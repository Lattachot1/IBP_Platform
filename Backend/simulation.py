"""
What-if constraint engine: the planning rules, the scenario models and the
in-memory scenario store (used when no database is configured).

Prepared for UBE Chemicals (Asia) PCL
"""

import threading
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from pydantic import BaseModel, Field

from forecasting import MODEL_NAME, generate_forecast, go_round

# ----------------------------------------------------------------------------
# Business Rules Constants (unchanged from the legacy Go engine)
# ----------------------------------------------------------------------------
NORMAL_CAPACITY_LIMIT = 10500.0
OVERTIME_EXTRA_CAPACITY = 1500.0
OVERTIME_COST_THB = 120000.0
PRODUCT_UNIT_PRICE_THB = 1000.0

# ----------------------------------------------------------------------------
# API Models (field names and JSON shapes identical to the Go backend)
# ----------------------------------------------------------------------------
class Scenario(BaseModel):
    scenario_id: int = 0
    scenario_name: str = ""
    base_demand: float = 0.0
    demand_change_pct: float = 0.0
    forecast_demand: float = 0.0
    lower_bound: float = 0.0
    upper_bound: float = 0.0
    capacity_limit: float = 0.0
    enable_ot: bool = False
    actual_produce: float = 0.0
    shortage_qty: float = 0.0
    service_level_pct: float = 0.0
    revenue_thb: float = 0.0
    extra_cost_thb: float = 0.0
    constraint_status: str = ""
    model_name: str = ""
    created_by: str = ""
    created_at: Optional[datetime] = None


class SimulateRequest(BaseModel):
    """What-if inputs. Also the body of /api/scenarios/save: any result
    fields a client sends along are ignored and recomputed.

    String limits mirror dbo.Scenarios (NVARCHAR(100) / NVARCHAR(50)); the
    number ranges are sanity bounds well outside what the dashboard offers.
    """

    scenario_name: str = Field(default="", max_length=100)
    base_demand: float = Field(default=10000.0, gt=0, le=1_000_000, allow_inf_nan=False)
    demand_change_pct: float = Field(default=0.0, ge=-100, le=500, allow_inf_nan=False)
    enable_ot: bool = False
    created_by: str = Field(default="", max_length=50)


# ----------------------------------------------------------------------------
# In-Memory Fallback Store (mirrors the legacy Go store + seed scenarios)
# ----------------------------------------------------------------------------
class InMemoryStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._next_id = 4
        now = datetime.now(timezone.utc)
        self._scenarios: List[Scenario] = [
            Scenario(
                scenario_id=1,
                scenario_name="Base Plan (Normal Baseline)",
                base_demand=10000.0,
                demand_change_pct=0.0,
                forecast_demand=10000.0,
                lower_bound=9500.0,
                upper_bound=10500.0,
                capacity_limit=10500.0,
                enable_ot=False,
                actual_produce=10000.0,
                shortage_qty=0.0,
                service_level_pct=100.0,
                revenue_thb=10000000.0,
                extra_cost_thb=0.0,
                constraint_status="Feasible / Normal Capacity",
                model_name=MODEL_NAME,
                created_by="Supply Chain Lead",
                created_at=now - timedelta(hours=2),
            ),
            Scenario(
                scenario_id=2,
                scenario_name="Demand Surge (+20%) - Constrained Bottleneck",
                base_demand=10000.0,
                demand_change_pct=20.0,
                forecast_demand=12000.0,
                lower_bound=11400.0,
                upper_bound=12600.0,
                capacity_limit=10500.0,
                enable_ot=False,
                actual_produce=10500.0,
                shortage_qty=1500.0,
                service_level_pct=87.5,
                revenue_thb=10500000.0,
                extra_cost_thb=0.0,
                constraint_status="Capacity Overload Bottleneck (Shortage: 1,500 units)",
                model_name=MODEL_NAME,
                created_by="Sales & Commercial",
                created_at=now - timedelta(hours=1),
            ),
            Scenario(
                scenario_id=3,
                scenario_name="Demand Surge (+20%) - With Overtime Lever",
                base_demand=10000.0,
                demand_change_pct=20.0,
                forecast_demand=12000.0,
                lower_bound=11400.0,
                upper_bound=12600.0,
                capacity_limit=12000.0,
                enable_ot=True,
                actual_produce=12000.0,
                shortage_qty=0.0,
                service_level_pct=100.0,
                revenue_thb=12000000.0,
                extra_cost_thb=120000.0,
                constraint_status="Feasible (Overtime Shift Activated)",
                model_name=MODEL_NAME,
                created_by="Executive Committee",
                created_at=now - timedelta(minutes=15),
            ),
        ]

    def save(self, scenario: Scenario) -> Scenario:
        with self._lock:
            scenario.scenario_id = self._next_id
            self._next_id += 1
            scenario.created_at = datetime.now(timezone.utc)
            self._scenarios.insert(0, scenario)
            return scenario

    def recent(self, limit: int = 10) -> List[Scenario]:
        with self._lock:
            ordered = sorted(
                self._scenarios,
                key=lambda s: s.created_at or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )
            return [s.model_copy(deep=True) for s in ordered[:limit]]


store = InMemoryStore()


def run_simulation(req: SimulateRequest) -> Scenario:
    """The What-if constraint engine (legacy Go handleSimulate) - the only
    place the capacity / overtime / revenue rules are applied."""
    scenario_name = req.scenario_name if req.scenario_name else "What-If Simulation"
    base_demand = req.base_demand
    created_by = req.created_by if req.created_by else "Planner (Interactive)"

    # 1. Get demand forecast with confidence bands (in-process engine)
    forecast, lower, upper, model_name = generate_forecast(
        base_demand, req.demand_change_pct
    )

    # 2. Compute production capacity limit & costs
    capacity_limit = NORMAL_CAPACITY_LIMIT
    extra_cost = 0.0
    if req.enable_ot:
        capacity_limit += OVERTIME_EXTRA_CAPACITY
        extra_cost += OVERTIME_COST_THB

    # 3. Compute production feasibility & constraints
    actual_produce = min(forecast, capacity_limit)
    if actual_produce < 0:
        actual_produce = 0.0

    shortage_qty = max(0.0, forecast - actual_produce)

    # 4. Compute service level (%) — Go: math.Round((actual/forecast)*10000)/100
    service_level_pct = 100.0
    if forecast > 0:
        service_level_pct = go_round((actual_produce / forecast) * 10000.0) / 100.0
        if service_level_pct > 100.0:
            service_level_pct = 100.0

    # 5. Compute financials — Go: math.Round(actualProduce * price)
    revenue_thb = go_round(actual_produce * PRODUCT_UNIT_PRICE_THB)

    # 6. Constraint status (shortage formatted without separators, like Go)
    if forecast > capacity_limit:
        constraint_status = "Capacity Overload Bottleneck (Shortage: %d units)" % round(shortage_qty)
    elif req.enable_ot:
        constraint_status = "Feasible (Overtime Shift Activated)"
    else:
        constraint_status = "Feasible / Normal Capacity"

    return Scenario(
        scenario_name=scenario_name,
        base_demand=base_demand,
        demand_change_pct=req.demand_change_pct,
        forecast_demand=forecast,
        lower_bound=lower,
        upper_bound=upper,
        capacity_limit=capacity_limit,
        enable_ot=req.enable_ot,
        actual_produce=actual_produce,
        shortage_qty=shortage_qty,
        service_level_pct=service_level_pct,
        revenue_thb=revenue_thb,
        extra_cost_thb=extra_cost,
        constraint_status=constraint_status,
        model_name=model_name,
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
