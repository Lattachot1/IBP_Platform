"""
AI-Driven Integrated Business Planning (IBP) Platform
Backend Simulation Engine (FastAPI, Python-only)

Prepared for UBE Chemicals (Asia) PCL
Tenet: "One Platform, One Data, One Plan"

Unified backend: this single service carries the constraint/simulation
engine, the scenario audit trail (MS SQL with in-memory fallback) and the
in-process forecasting engine that used to live in the standalone Go
backend and model-service. Endpoint paths, payloads and response shapes
are unchanged, so the existing Next.js dashboard works as-is.
"""

import logging
import math
import threading
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import database
from forecasting import MODEL_NAME, generate_forecast, go_round, round2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ibp.main")

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
    scenario_name: str = ""
    base_demand: float = 0.0
    demand_change_pct: float = 0.0
    enable_ot: bool = False
    created_by: str = ""


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

# ----------------------------------------------------------------------------
# FastAPI Application
# ----------------------------------------------------------------------------
app = FastAPI(
    title="UBE IBP - Backend Simulation Engine",
    description="Constraint Engine & Scenario Simulator with in-process "
                "Forecasting (unified Python backend)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    log.info("==================================================")
    log.info(" UBE Chemicals (Asia) PCL - AI IBP Platform Engine")
    log.info(" Tenet: 'One Platform, One Data, One Plan'")
    log.info(" Backend Server listening (unified Python engine)")
    log.info("==================================================")
    # Mirrors the legacy Go connectDatabase(): never crashes the service,
    # falls back to in-memory mode on any problem.
    database.connect_database()


@app.get("/api/health")
def handle_health():
    db_status = "In-Memory Mode (Active)"
    if database.is_connected():
        try:
            database.ping()
            db_status = "Connected (MS SQL Server 2022)"
        except Exception as exc:
            db_status = "Error (%s)" % exc

    return {
        "status": "healthy",
        "service": "UBE IBP Backend Simulation Engine",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_status,
        "model_service": "Connected (in-process forecasting engine)",
        "planning_rules": {
            "normal_capacity": NORMAL_CAPACITY_LIMIT,
            "overtime_capacity": OVERTIME_EXTRA_CAPACITY,
            "overtime_cost_thb": OVERTIME_COST_THB,
            "product_price_thb": PRODUCT_UNIT_PRICE_THB,
        },
    }


def _reject_non_finite(values: dict) -> None:
    """Reject NaN/Infinity payloads the way the Go JSON decoder used to
    (HTTP 400), instead of letting them poison the math (which would 500)."""
    for name, value in values.items():
        if isinstance(value, float) and not math.isfinite(value):
            raise HTTPException(
                status_code=400,
                detail="Invalid request payload: field '%s' must be a finite number" % name,
            )


@app.post("/api/simulate", response_model=Scenario)
def handle_simulate(req: SimulateRequest) -> Scenario:
    """Run a What-if constraint simulation (legacy Go handleSimulate)."""
    _reject_non_finite({
        "base_demand": req.base_demand,
        "demand_change_pct": req.demand_change_pct,
    })
    scenario_name = req.scenario_name if req.scenario_name else "What-If Simulation"
    base_demand = req.base_demand if req.base_demand > 0 else 10000.0
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


@app.post("/api/scenarios/save", response_model=Scenario, status_code=201)
def handle_save_scenario(sc: Scenario) -> Scenario:
    """Store a scenario to MS SQL or the in-memory store (legacy handleSaveScenario)."""
    _reject_non_finite({
        "base_demand": sc.base_demand,
        "demand_change_pct": sc.demand_change_pct,
        "forecast_demand": sc.forecast_demand,
        "lower_bound": sc.lower_bound,
        "upper_bound": sc.upper_bound,
        "capacity_limit": sc.capacity_limit,
        "actual_produce": sc.actual_produce,
        "shortage_qty": sc.shortage_qty,
        "service_level_pct": sc.service_level_pct,
        "revenue_thb": sc.revenue_thb,
        "extra_cost_thb": sc.extra_cost_thb,
    })
    if not sc.scenario_name:
        sc.scenario_name = "Custom Scenario"
    if not sc.created_by:
        sc.created_by = "Planner"
    if sc.created_at is None:
        sc.created_at = datetime.now(timezone.utc)

    # Try saving to MS SQL if connected
    if database.is_connected():
        try:
            inserted_id, inserted_at = database.insert_scenario(sc.model_dump())
            sc.scenario_id = inserted_id
            sc.created_at = inserted_at
            return sc
        except Exception as exc:
            log.warning("[Database Warning] Insert to MS SQL failed: %s. Saving to In-Memory store instead.", exc)

    # In-memory fallback persistence
    return store.save(sc)


@app.get("/api/scenarios", response_model=List[Scenario])
def handle_get_scenarios() -> List[Scenario]:
    """Retrieve the 10 most recent scenarios (legacy handleGetScenarios)."""
    # Try reading from MS SQL DB
    if database.is_connected():
        try:
            rows = database.fetch_top_scenarios(10)
        except Exception as exc:
            log.info("[Database Note] Query failed (%s), returning In-Memory scenarios.", exc)
            rows = []

        if rows:
            scenarios: List[Scenario] = []
            for row in rows:
                # Enrich bounds for UI display (legacy read-path behavior:
                # the DB schema does not persist these columns yet)
                row["lower_bound"] = round2(row["forecast_demand"] * 0.95)
                row["upper_bound"] = round2(row["forecast_demand"] * 1.05)
                row["model_name"] = MODEL_NAME
                scenarios.append(Scenario(**row))
            return scenarios

    # Return in-memory scenarios, sorted newest first
    return store.recent(10)


if __name__ == "__main__":
    import os

    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
