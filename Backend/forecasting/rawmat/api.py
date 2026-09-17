"""
FastAPI router for the butadiene forecast.

Keeps the original model-service contract (GET and POST
/api/v1/raw-material-price/forecast with symbol + horizon_months) and adds
history, the backtest leaderboard and retrain. Engines come from
forecasting.registry ("rawmat").
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import registry
from . import data, service

log = logging.getLogger("ibp.rawmat.api")

router = APIRouter(prefix="/api/v1/raw-material-price", tags=["raw-material"])


class RawMaterialForecastRequest(BaseModel):
    symbol: str = Field(default=data.SYMBOL, min_length=1)
    horizon_months: int = Field(default=4, ge=1, le=service.MAX_HORIZON)


def _engine() -> dict:
    engine = registry.get("rawmat")
    if engine is None:
        raise HTTPException(status_code=503, detail="Raw-material forecast engine unavailable")
    return engine


def _response(symbol: str, horizon_months: int) -> dict:
    engine = _engine()
    if symbol != engine["symbol"]:
        raise HTTPException(
            status_code=404,
            detail={"error": f"No forecast artifact is available for symbol {symbol}", "available": [engine["symbol"]]},
        )
    return service.forecast_response(engine, horizon_months)


@router.get("/forecast")
def get_forecast(
    symbol: str = Query(default=data.SYMBOL),
    horizon_months: int = Query(default=4, ge=1, le=service.MAX_HORIZON),
):
    """Butadiene P10/P50/P90 purchasing cases per month."""
    return _response(symbol, horizon_months)


@router.post("/forecast")
def post_forecast(req: RawMaterialForecastRequest):
    """Same payload as GET; kept for the original dashboard code."""
    return _response(req.symbol, req.horizon_months)


@router.get("/history")
def history():
    """Monthly BD price history behind the model."""
    engine = _engine()
    return {
        "symbol": engine["symbol"],
        "unit": engine["unit"],
        "last_month": engine.get("last_month"),
        "months": engine.get("history", []),
    }


@router.get("/models")
def models():
    """Backtest leaderboard: MAE per horizon for every candidate, champion flagged."""
    engine = _engine()
    return {
        "artifact_version": engine["artifact_version"],
        "forecast_origin": engine["forecast_origin"],
        "champion": engine.get("champion", engine["model_name"]),
        "engine_source": engine.get("engine_source"),
        "protocol": engine.get("protocol"),
        "interval": {k: v for k, v in (engine.get("interval") or {}).items() if k != "table"},
        "models": service.leaderboard_rows(engine),
    }


@router.post("/retrain")
def retrain():
    """Refit from the BD data file and rewrite the artifact."""
    try:
        engine = service.train_all()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Retrain failed, previous engine kept: {exc}")
    try:
        service.save_artifact(engine)
    except OSError as exc:
        log.warning("[RawMat] artifact not written after retrain: %s", exc)
    engine["engine_source"] = "trained"
    registry.set_engine("rawmat", engine)
    return {
        "status": "retrained",
        "artifact_version": engine["artifact_version"],
        "champion": engine["champion"],
        "validation_mae": engine["validation_mae"],
    }
