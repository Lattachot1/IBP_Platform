"""What-if simulation and the scenario audit trail (MS SQL or in-memory)."""

import logging
from typing import List

from fastapi import APIRouter, HTTPException

import database
from forecasting import MODEL_NAME, round2
from simulation import Scenario, SimulateRequest, run_simulation, store

log = logging.getLogger("ibp.api.scenarios")

router = APIRouter(tags=["scenarios"])


@router.post("/api/simulate", response_model=Scenario)
def handle_simulate(req: SimulateRequest) -> Scenario:
    """Run a What-if constraint simulation."""
    return run_simulation(req)


@router.post("/api/scenarios/save", response_model=Scenario, status_code=201)
def handle_save_scenario(req: SimulateRequest) -> Scenario:
    """Recompute a scenario from its inputs and store it.

    The stored figures always come from run_simulation(), never from the
    client. With a database configured a failed insert is a 503 - the
    scenario is NOT parked in memory, where it would vanish on restart.
    """
    sc = run_simulation(req)
    if database.is_configured():
        try:
            sc.scenario_id, sc.created_at = database.insert_scenario(sc.model_dump())
        except Exception:
            log.exception("[Database] Insert into dbo.Scenarios failed")
            raise HTTPException(status_code=503, detail="Database unavailable: scenario NOT saved")
        return sc
    return store.save(sc)


@router.get("/api/scenarios", response_model=List[Scenario])
def handle_get_scenarios() -> List[Scenario]:
    """Retrieve the 10 most recent scenarios."""
    if not database.is_configured():
        return store.recent(10)

    try:
        rows = database.fetch_top_scenarios(10)
    except Exception:
        log.exception("[Database] Query on dbo.Scenarios failed")
        raise HTTPException(status_code=503, detail="Database unavailable: could not load scenarios")

    scenarios: List[Scenario] = []
    for row in rows:
        # The DB does not persist these columns: the legacy engine's band is
        # a fixed +-5% of the forecast and its model name never changes, so
        # recomputing them gives back exactly what was shown when saved.
        row["lower_bound"] = round2(row["forecast_demand"] * 0.95)
        row["upper_bound"] = round2(row["forecast_demand"] * 1.05)
        row["model_name"] = MODEL_NAME
        scenarios.append(Scenario(**row))
    return scenarios
