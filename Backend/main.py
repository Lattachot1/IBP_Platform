"""
AI-Driven Integrated Business Planning (IBP) Platform
Backend Simulation Engine (FastAPI, Python-only)

Prepared for UBE Chemicals (Asia) PCL
Tenet: "One Platform, One Data, One Plan"

Unified backend: this single service carries the constraint/simulation
engine (simulation.py), the scenario audit trail (MS SQL; in-memory when
no database is configured), the in-process forecasting engine and the
production optimizer. This module only builds the app; the endpoints live
in api/ (health, scenarios, forecast, optimize).
"""

import logging
import math

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import database
from api import forecast, health, optimize, scenarios

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ibp.main")

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


def _json_safe(value):
    """NaN/Infinity -> strings, recursively (JSON has no such numbers)."""
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's default 422, except that the echoed input may hold NaN or
    Infinity, which JSON cannot encode - that would turn the 422 into a 500."""
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(_json_safe(exc.errors()))})


@app.on_event("startup")
def on_startup() -> None:
    log.info("==================================================")
    log.info(" UBE Chemicals (Asia) PCL - AI IBP Platform Engine")
    log.info(" Tenet: 'One Platform, One Data, One Plan'")
    log.info(" Backend Server listening (unified Python engine)")
    log.info("==================================================")
    # No database configured -> in-memory mode. A configured one stays in
    # use even if it is down right now (requests answer 503 until it is
    # back); a broken configuration stops the startup here.
    database.connect_database()

    forecast.train_at_startup()


app.include_router(health.router)
app.include_router(scenarios.router)
app.include_router(forecast.router)
app.include_router(optimize.router)


if __name__ == "__main__":
    import os

    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
