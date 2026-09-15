"""Forecasting APIs for the IBP platform."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


ARTIFACT_PATH = Path(__file__).resolve().parent / "artifacts" / "butadiene_forecast.json"

app = FastAPI(
    title="UBE IBP - Model Forecasting Service",
    description="Demand simulation and probabilistic raw-material price forecasts",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ForecastRequest(BaseModel):
    base_demand: float = Field(..., gt=0)
    demand_change_pct: float


class ForecastResponse(BaseModel):
    forecast: float
    lower_bound: float
    upper_bound: float
    model_name: str


class RawMaterialForecastRequest(BaseModel):
    symbol: str = Field(default="PA0033242", min_length=1)
    horizon_months: int = Field(default=4, ge=1, le=4)


class RawMaterialForecastPoint(BaseModel):
    target_month: str
    horizon: int
    point: float
    p025: float
    p10: float
    p50: float
    p90: float
    p975: float
    best_purchase_case: float
    base_case: float
    worst_purchase_case: float


class RawMaterialForecastResponse(BaseModel):
    artifact_version: str
    symbol: str
    commodity: str
    market: str
    unit: str
    forecast_origin: str
    model_name: str
    validation_mae: float
    readiness: str
    scenario_interpretation: str
    forecasts: list[RawMaterialForecastPoint]


def _validate_artifact(payload: dict[str, Any]) -> None:
    required = {
        "artifact_version",
        "symbol",
        "commodity",
        "market",
        "unit",
        "forecast_origin",
        "model_name",
        "validation_mae",
        "readiness",
        "scenario_interpretation",
        "forecasts",
    }
    missing = required.difference(payload)
    if missing:
        raise ValueError(f"Forecast artifact is missing fields: {sorted(missing)}")

    forecasts = payload["forecasts"]
    if not forecasts:
        raise ValueError("Forecast artifact contains no forecast rows")

    expected_horizon = 1
    for row in forecasts:
        if row.get("horizon") != expected_horizon:
            raise ValueError("Forecast horizons must be sequential and start at 1")
        quantiles = [row.get(key) for key in ("p025", "p10", "p50", "p90", "p975")]
        if any(value is None for value in quantiles) or quantiles != sorted(quantiles):
            raise ValueError(f"Invalid forecast quantile order at horizon {expected_horizon}")
        expected_horizon += 1


@lru_cache(maxsize=1)
def load_butadiene_artifact() -> dict[str, Any]:
    payload = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
    _validate_artifact(payload)
    return payload


@app.get("/")
def read_root() -> dict[str, str]:
    return {
        "service": "UBE IBP Model Forecasting Service",
        "status": "online",
        "version": "1.1.0",
        "methodology": "Demand simulator and versioned probabilistic forecast artifacts",
    }


@app.get("/health")
def health_check() -> dict[str, str]:
    try:
        artifact = load_butadiene_artifact()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Butadiene artifact is unhealthy: {exc}",
        ) from exc
    return {
        "status": "healthy",
        "butadiene_artifact": f"loaded:{artifact['artifact_version']}",
    }


@app.post("/api/v1/forecast", response_model=ForecastResponse)
def generate_forecast(req: ForecastRequest) -> ForecastResponse:
    """Retain the original illustrative demand endpoint for the existing UI."""
    point_forecast = max(0.0, round(req.base_demand * (1.0 + req.demand_change_pct / 100.0), 2))
    return ForecastResponse(
        forecast=point_forecast,
        lower_bound=round(point_forecast * 0.95, 2),
        upper_bound=round(point_forecast * 1.05, 2),
        model_name="Illustrative demand change baseline",
    )


def _raw_material_response(req: RawMaterialForecastRequest) -> RawMaterialForecastResponse:
    try:
        artifact = load_butadiene_artifact()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail=f"Forecast artifact unavailable: {exc}") from exc

    if req.symbol != artifact["symbol"]:
        raise HTTPException(
            status_code=404,
            detail=f"No forecast artifact is available for symbol {req.symbol}",
        )

    response = dict(artifact)
    response["forecasts"] = response["forecasts"][: req.horizon_months]
    return RawMaterialForecastResponse.model_validate(response)


@app.post(
    "/api/v1/raw-material-price/forecast",
    response_model=RawMaterialForecastResponse,
)
def generate_raw_material_forecast(
    req: RawMaterialForecastRequest,
) -> RawMaterialForecastResponse:
    return _raw_material_response(req)


@app.get(
    "/api/v1/raw-material-price/forecast",
    response_model=RawMaterialForecastResponse,
)
def get_raw_material_forecast(
    symbol: str = Query(default="PA0033242"),
    horizon_months: int = Query(default=4, ge=1, le=4),
) -> RawMaterialForecastResponse:
    return _raw_material_response(
        RawMaterialForecastRequest(symbol=symbol, horizon_months=horizon_months)
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
