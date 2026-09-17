"""
FastAPI router for the sale-price forecast and the revenue outlook.

Endpoints (all under /api/v1):
- GET  /price/models      champion leaderboard per grade
- GET  /price/history     monthly realized price, tonnage and BD for one grade
- GET  /price/forecast    price forecast with an 80% band under a BD scenario
- POST /price/retrain     refit from the data files and rewrite the artifact
- GET  /revenue/outlook   demand forecast (tons) x price forecast (USD/t) per grade

Engines are read from forecasting.registry, which main.py fills at startup.
"""

from __future__ import annotations

import logging
import math

from fastapi import APIRouter, HTTPException, Query

from .. import registry
from ..rawmat import service as rawmat_service
from . import service

log = logging.getLogger("ibp.price.api")

router = APIRouter(prefix="/api/v1", tags=["sale-price"])

SCENARIO_HELP = (
    "flat = hold BD at its last value shifted by bd_change_pct; "
    "low / base / high = the P10 / P50 / P90 path of the butadiene forecast"
)


def _bd_values_for(scenario: str, horizon: int) -> tuple:
    """BD path for the scenario: None for flat (the percentage shift applies),
    else the quantile path of the butadiene engine. Returns (values, description)."""
    if scenario not in rawmat_service.SCENARIOS:
        raise HTTPException(
            status_code=400,
            detail=f"bd_scenario must be one of {list(rawmat_service.SCENARIOS)}",
        )
    if scenario == "flat":
        return None, "last BD held flat, shifted by bd_change_pct"
    rawmat_engine = registry.get("rawmat")
    if rawmat_engine is None:
        raise HTTPException(
            status_code=503,
            detail="Butadiene forecast engine unavailable; use bd_scenario=flat",
        )
    values = rawmat_service.scenario_path(rawmat_engine, scenario, horizon)
    quantile = rawmat_service.SCENARIO_QUANTILE[scenario].upper()
    return values, f"butadiene forecast {quantile} ({rawmat_engine['artifact_version']})"


def _engine() -> dict:
    engine = registry.get("price")
    if engine is None:
        raise HTTPException(
            status_code=503,
            detail="Sale-price engine unavailable (billing/BD data or artifact missing)",
        )
    return engine


def _grade(engine: dict, product_id: str | None) -> tuple:
    grades = engine["grades"]
    if product_id is None:
        product_id = next(iter(grades))
    if product_id not in grades:
        raise HTTPException(
            status_code=404,
            detail={"error": "unknown product_id", "available": sorted(grades)},
        )
    return product_id, grades[product_id]


@router.get("/price/models")
def price_models():
    """Champion leaderboard per product grade (from the nested backtest)."""
    engine = _engine()
    return {
        "trained_at": engine["trained_at"],
        "artifact_version": engine.get("artifact_version"),
        "target": engine.get("target"),
        "bd_symbol": engine.get("bd_symbol"),
        "bd_last_month": engine.get("bd_last_month"),
        "bd_last": engine.get("bd_last"),
        "protocol": engine.get("protocol"),
        "models": service.leaderboard_rows(engine),
    }


@router.get("/price/history")
def price_history(product_id: str = Query(default=None)):
    """Monthly realized FOB and net price, tonnage and BD for one grade."""
    engine = _engine()
    product_id, info = _grade(engine, product_id)
    return {
        "product_id": product_id,
        "trained_through": info["trained_through"],
        "months": info.get("history", []),
        "avg_price": round(float(info["avg_price"]), 1),
        "last_price": round(float(info["last_price"]), 1),
    }


@router.get("/price/forecast")
def price_forecast(
    product_id: str = Query(default=None),
    horizon_months: int = Query(default=3, ge=1, le=service.MAX_HORIZON),
    bd_change_pct: float = Query(default=0.0, ge=-90.0, le=300.0),
    bd_scenario: str = Query(default="flat", description=SCENARIO_HELP),
):
    """Selling-price forecast (USD/t) for one grade under a BD price scenario."""
    if not math.isfinite(bd_change_pct):
        raise HTTPException(status_code=400, detail="bd_change_pct must be a finite number")
    engine = _engine()
    product_id, info = _grade(engine, product_id)
    bd_values, bd_source = _bd_values_for(bd_scenario, horizon_months)
    result = service.forecast(info, horizon_months, bd_change_pct, bd_values)
    return {
        "product_id": product_id,
        "basis": engine.get("target"),
        "trained_through": info["trained_through"],
        "horizon_months": horizon_months,
        "bd_change_pct": bd_change_pct,
        "bd_scenario": bd_scenario,
        "bd_source": bd_source,
        "bd_last": info["bd_last"],
        "bd_last_month": engine.get("bd_last_month"),
        **result,
        "interval": {
            "level_pct": info["interval_level_pct"],
            "coverage_empirical": info.get("coverage_empirical"),
            "method": "per-horizon residual-quantile band from the backtest; sqrt(h) beyond the backtested horizon",
        },
        "metrics": {
            "mape": info.get("mape"),
            "mape_holdout": info.get("mape_holdout"),
            "naive_mape": info.get("naive_mape"),
            "mape_h": info.get("mape_h"),
        },
        "note": "Month 1 uses the last known BD price; the BD scenario applies from month 2 onward.",
    }


@router.post("/price/retrain")
def price_retrain():
    """Refit every grade from the data files and rewrite the artifact."""
    try:
        engine = service.train_all()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Retrain failed, previous engine kept: {exc}")
    try:
        service.save_artifact(engine)
    except OSError as exc:
        log.warning("[Price] artifact not written after retrain: %s", exc)
    registry.set_engine("price", engine)
    return {
        "status": "retrained",
        "trained_at": engine["trained_at"],
        "grades": {name: {"champion": info["champion"], "mape": info["mape"]} for name, info in engine["grades"].items()},
    }


@router.get("/revenue/outlook")
def revenue_outlook(
    horizon_months: int = Query(default=3, ge=1, le=service.MAX_HORIZON),
    bd_change_pct: float = Query(default=0.0, ge=-90.0, le=300.0),
    demand_change_pct: float = Query(default=0.0, ge=-100.0, le=300.0),
    bd_scenario: str = Query(default="flat", description=SCENARIO_HELP),
):
    """FOB revenue outlook per grade: demand forecast (tons) x sale-price forecast P50 (USD/t)."""
    price_engine = _engine()
    demand_engine = registry.get("demand")
    if demand_engine is None:
        raise HTTPException(status_code=503, detail="Demand engine unavailable (billing data missing)")
    from .. import service as demand_service

    bd_values, bd_source = _bd_values_for(bd_scenario, horizon_months)
    grades_out, skipped, totals = [], [], {}
    for grade, price_info in price_engine["grades"].items():
        demand_info = demand_engine["grades"].get(grade)
        if demand_info is None:
            skipped.append(grade)
            continue
        price_fc = service.forecast(price_info, horizon_months, bd_change_pct, bd_values)
        demand_fc = demand_service.forecast(demand_info, horizon_months, demand_change_pct)
        price_by_period = dict(zip(price_fc["periods"], price_fc["forecast"]))

        months = []
        for period, tons in zip(demand_fc["periods"], demand_fc["forecast_tons"]):
            price = price_by_period.get(period)
            if price is None:
                continue
            tons = float(tons)
            revenue = tons * price
            months.append({
                "period": period,
                "tons": round(tons, 1),
                "price_usd_t": round(price, 2),
                "revenue_usd": round(revenue, 0),
            })
            bucket = totals.setdefault(period, {"tons": 0.0, "revenue_usd": 0.0})
            bucket["tons"] += tons
            bucket["revenue_usd"] += revenue

        grades_out.append({
            "product_id": grade,
            "months": months,
            "total_tons": round(sum(m["tons"] for m in months), 1),
            "total_revenue_usd": round(sum(m["revenue_usd"] for m in months), 0),
            "price_model": price_fc["model_name"],
            "demand_model": demand_info["champion"],
        })

    totals_list = [
        {"period": period, "tons": round(v["tons"], 1), "revenue_usd": round(v["revenue_usd"], 0)}
        for period, v in sorted(totals.items())
    ]
    return {
        "horizon_months": horizon_months,
        "bd_change_pct": bd_change_pct,
        "demand_change_pct": demand_change_pct,
        "bd_scenario": bd_scenario,
        "bd_source": bd_source,
        "basis": "FOB revenue = demand forecast (tons) x sale-price forecast P50 (USD/t); month 1 uses the last known BD",
        "periods": [t["period"] for t in totals_list],
        "grades": grades_out,
        "totals": totals_list,
        "grand_total_tons": round(sum(t["tons"] for t in totals_list), 1),
        "grand_total_revenue_usd": round(sum(t["revenue_usd"] for t in totals_list), 0),
        "skipped": skipped,
    }
