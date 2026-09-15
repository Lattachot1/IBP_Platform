"""
AI-Driven Integrated Business Planning (IBP) Platform
Optional Python Dev Runner for Backend (Port 8080)
Provides identical REST API endpoints to Go backend (backend/main.go)
for immediate zero-dependency testing on Windows before Go or Docker is installed.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import datetime
import json
import math
import os
import urllib.error
import urllib.request

app = FastAPI(
    title="UBE IBP Backend Simulation Engine (Dev Runner)",
    description="Constraint Engine & Scenario Simulator mirroring Go backend",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
NORMAL_CAPACITY = 10500.0
OT_EXTRA_CAPACITY = 1500.0
OT_COST_THB = 120000.0
UNIT_PRICE_THB = 1000.0

class SimulateRequest(BaseModel):
    scenario_name: str = "What-If Simulation"
    base_demand: float = 10000.0
    demand_change_pct: float = 20.0
    enable_ot: bool = False
    created_by: str = "Planner (Interactive)"

class RawMaterialForecastRequest(BaseModel):
    symbol: str = "PA0033242"
    horizon_months: int = Field(default=4, ge=1, le=4)

class Scenario(BaseModel):
    scenario_id: Optional[int] = None
    scenario_name: str
    base_demand: float
    demand_change_pct: float
    forecast_demand: float
    lower_bound: float
    upper_bound: float
    capacity_limit: float
    enable_ot: bool
    actual_produce: float
    shortage_qty: float
    service_level_pct: float
    revenue_thb: float
    extra_cost_thb: float
    constraint_status: str
    model_name: str = "Ensemble Baseline (ETS/ML)"
    created_by: str
    created_at: Optional[str] = None

# Initial In-Memory Seed Scenarios matching Capstone proposal
in_memory_scenarios: List[Scenario] = [
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
        model_name="Ensemble Baseline (ETS/ML)",
        created_by="Supply Chain Lead",
        created_at=(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)).isoformat()
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
        model_name="Ensemble Baseline (ETS/ML)",
        created_by="Sales & Commercial",
        created_at=(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)).isoformat()
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
        model_name="Ensemble Baseline (ETS/ML)",
        created_by="Executive Committee",
        created_at=(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=15)).isoformat()
    )
]

next_id = 4

@app.get("/api/health")
def get_health():
    return {
        "status": "healthy",
        "service": "UBE IBP Backend Simulation Engine (Dev Runner)",
        "version": "1.0.0",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "database": "In-Memory Mode (Active)",
        "model_service": "Integrated Baseline Engine",
        "planning_rules": {
            "normal_capacity": NORMAL_CAPACITY,
            "overtime_capacity": OT_EXTRA_CAPACITY,
            "overtime_cost_thb": OT_COST_THB,
            "product_price_thb": UNIT_PRICE_THB
        }
    }

@app.post("/api/simulate", response_model=Scenario)
def simulate(req: SimulateRequest):
    # Forecast with confidence intervals
    forecast = round(req.base_demand * (1.0 + req.demand_change_pct / 100.0), 2)
    lower = round(forecast * 0.95, 2)
    upper = round(forecast * 1.05, 2)

    # Capacity and extra costs
    capacity_limit = NORMAL_CAPACITY
    extra_cost = 0.0
    if req.enable_ot:
        capacity_limit += OT_EXTRA_CAPACITY
        extra_cost += OT_COST_THB

    actual_produce = min(forecast, capacity_limit)
    shortage_qty = max(0.0, forecast - actual_produce)
    service_level = round((actual_produce / forecast * 100.0), 2) if forecast > 0 else 100.0
    revenue = round(actual_produce * UNIT_PRICE_THB, 2)

    if forecast > capacity_limit:
        status = f"Capacity Overload Bottleneck (Shortage: {int(shortage_qty):,} units)"
    elif req.enable_ot:
        status = "Feasible (Overtime Shift Activated)"
    else:
        status = "Feasible / Normal Capacity"

    return Scenario(
        scenario_name=req.scenario_name,
        base_demand=req.base_demand,
        demand_change_pct=req.demand_change_pct,
        forecast_demand=forecast,
        lower_bound=lower,
        upper_bound=upper,
        capacity_limit=capacity_limit,
        enable_ot=req.enable_ot,
        actual_produce=actual_produce,
        shortage_qty=shortage_qty,
        service_level_pct=service_level,
        revenue_thb=revenue,
        extra_cost_thb=extra_cost,
        constraint_status=status,
        model_name="Ensemble Baseline (ETS/ML)",
        created_by=req.created_by,
        created_at=datetime.datetime.now(datetime.timezone.utc).isoformat()
    )

@app.post("/api/raw-material-price/forecast")
def raw_material_price_forecast(req: RawMaterialForecastRequest):
    model_service_url = os.getenv("MODEL_SERVICE_URL", "http://localhost:5000").rstrip("/")
    request = urllib.request.Request(
        f"{model_service_url}/api/v1/raw-material-price/forecast",
        data=json.dumps(req.model_dump()).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Raw-material forecast service is unavailable: {exc}",
        ) from exc

@app.post("/api/scenarios/save", response_model=Scenario, status_code=201)
def save_scenario(sc: Scenario):
    global next_id
    sc.scenario_id = next_id
    next_id += 1
    sc.created_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    in_memory_scenarios.insert(0, sc)
    return sc

@app.get("/api/scenarios", response_model=List[Scenario])
def get_scenarios():
    return in_memory_scenarios[:10]

if __name__ == "__main__":
    import uvicorn
    print("Starting UBE IBP Backend Dev Runner on http://localhost:8080 ...")
    uvicorn.run("dev_runner:app", host="0.0.0.0", port=8080, reload=True)
