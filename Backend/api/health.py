"""Service health: database mode, forecast engine and the planning rules."""

from datetime import datetime, timezone

from fastapi import APIRouter

import database
from api.forecast import engine_status
from simulation import (
    NORMAL_CAPACITY_LIMIT,
    OVERTIME_COST_THB,
    OVERTIME_EXTRA_CAPACITY,
    PRODUCT_UNIT_PRICE_THB,
)

router = APIRouter(tags=["health"])


@router.get("/api/health")
def handle_health():
    db_status = "In-Memory Mode (Active)"
    if database.is_configured():
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
        # Where saved scenarios go: "memory" is lost when the backend restarts
        "storage": "database" if database.is_configured() else "memory",
        "model_service": "Connected (in-process forecasting engine)",
        "forecast_engine": engine_status(),
        "planning_rules": {
            "normal_capacity": NORMAL_CAPACITY_LIMIT,
            "overtime_capacity": OVERTIME_EXTRA_CAPACITY,
            "overtime_cost_thb": OVERTIME_COST_THB,
            "product_price_thb": PRODUCT_UNIT_PRICE_THB,
        },
    }
