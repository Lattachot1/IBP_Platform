"""Demand forecasting API (real models trained from the billing data).

Holds the trained engine: loaded at startup from a fingerprint-keyed cache
(when the billing data is unchanged) or trained in a background thread,
and replaced by POST /api/v1/retrain. None means the forecast API answers
503 while training runs or after a failure.
"""

import hashlib
import logging
import math
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from planning_data import engine_forecast
from planning_data.sql import StoreUnavailable, WriteRejected

log = logging.getLogger("ibp.api.forecast")

router = APIRouter(tags=["forecast"])

# Trained demand-forecasting engine (None = unavailable)
forecast_engine: Optional[dict] = None
# Background training state: idle | training | failed (engine None + failed = why)
_training = {"state": "idle", "started_at": None, "error": None}
# Bump after any change to the training pipeline so old caches are dropped
CACHE_VERSION = 1


def _cache_path() -> Path:
    env = os.getenv("FORECAST_CACHE_PATH", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[1] / ".forecast-cache" / "engine.joblib"


def _source_fingerprint() -> Optional[str]:
    """sha256 of the billing extract - the cache key. None = no data file."""
    from forecasting import data
    try:
        source = data.find_source_file()
    except Exception:
        return None
    digest = hashlib.sha256()
    with open(source, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_cached_engine() -> Optional[dict]:
    """The cached engine when the billing data is byte-identical, else None."""
    path = _cache_path()
    if not path.exists():
        return None
    try:
        import joblib
        payload = joblib.load(path)
        if payload.get("cache_version") != CACHE_VERSION:
            log.info("[Forecast] cache is from an older pipeline - retraining")
            return None
        fingerprint = _source_fingerprint()
        if fingerprint is None or payload.get("source_fingerprint") != fingerprint:
            log.info("[Forecast] billing data changed since the cache - retraining")
            return None
        engine = payload["engine"]
        engine["loaded_from_cache"] = True
        log.info("[Forecast] engine loaded from cache (%d grades) - no retraining needed",
                 len(engine["grades"]))
        return engine
    except Exception as exc:
        log.warning("[Forecast WARNING] cache unusable (%s) - retraining", exc)
        return None


def _save_cached_engine(engine: dict) -> None:
    """Persist the engine, keyed by the billing file's fingerprint (best effort)."""
    try:
        import joblib
        fingerprint = _source_fingerprint()
        if fingerprint is None:
            return
        path = _cache_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {"cache_version": CACHE_VERSION, "source_fingerprint": fingerprint, "engine": engine},
            path, compress=3,
        )
        log.info("[Forecast] engine cached at %s", path)
    except Exception as exc:
        log.warning("[Forecast WARNING] engine not cached: %s", exc)


def train_at_startup(background: bool = True) -> None:
    """Load the cached engine when the billing data is unchanged, else train.

    Training runs in a background thread so the API starts serving right
    away (health reports "training" meanwhile); background=False trains
    inline, which is what the tests use. Never fatal: a failure leaves the
    forecast API unavailable and every other flow working untouched.
    """
    global forecast_engine
    cached = _load_cached_engine()
    if cached is not None:
        forecast_engine = cached
        _log_champions(cached, "loaded from cache")
        return
    if os.getenv("IBP_SKIP_TRAIN", "").strip().lower() in {"1", "true", "yes"}:
        log.info("[Forecast] IBP_SKIP_TRAIN set - forecast stays unavailable until POST /api/v1/retrain")
        return
    if background:
        _training.update(state="training", started_at=datetime.now(timezone.utc).isoformat(), error=None)
        threading.Thread(target=_train_and_cache, name="forecast-training", daemon=True).start()
    else:
        _train_and_cache()


def _train_and_cache() -> None:
    global forecast_engine
    try:
        from forecasting import service
        engine = service.train_all()
    except Exception as exc:
        _training.update(state="failed", error=str(exc))
        log.warning("[Forecast WARNING] Engine training skipped: %s", exc)
        return
    forecast_engine = engine
    _training.update(state="idle", started_at=None, error=None)
    _log_champions(engine, "trained")
    _save_cached_engine(engine)
    # the planner reads the monthly forecast from dbo.DemandForecasts
    engine_forecast.publish_after_training(engine)


def _log_champions(engine: dict, how: str) -> None:
    log.info("[Forecast] Engine %s for %d grades:", how, len(engine["grades"]))
    for grade, info in engine["grades"].items():
        log.info("[Forecast]   %s -> %s (WAPE %.1f%%, MASE %.2f)",
                 grade, info["champion"], info["wape"] * 100, info["mase"])


def _require_engine() -> dict:
    if forecast_engine is None:
        if _training["state"] == "training":
            raise HTTPException(
                status_code=503,
                detail="Forecast engine is training in the background - try again in a few minutes",
            )
        raise HTTPException(
            status_code=503,
            detail="Forecast engine unavailable (billing data or ML libraries missing)",
        )
    return forecast_engine


def engine_status() -> dict:
    """Engine summary for /api/health."""
    if forecast_engine is None:
        if _training["state"] == "training":
            return {"status": "training", "started_at": _training["started_at"]}
        if _training["state"] == "failed":
            return {"status": "unavailable", "last_error": _training.get("error")}
        return {"status": "unavailable"}
    status = {
        "status": "trained",
        "grades": sorted(forecast_engine["grades"]),
        "trained_at": forecast_engine["trained_at"],
    }
    if forecast_engine.get("loaded_from_cache"):
        status["loaded_from_cache"] = True
    return status


def _round_or_none(value, digits: int):
    """Round a metric for JSON; NaN/inf become null (one bad grade must not 500 the leaderboard)."""
    value = float(value)
    return round(value, digits) if math.isfinite(value) else None


@router.get("/api/v1/models")
def handle_models():
    """Champion leaderboard per product grade (from the rolling backtest)."""
    engine = _require_engine()
    rows = []
    for name, info in engine["grades"].items():
        rows.append({
            "product_id": name,
            "champion": info["champion"],
            "wape": _round_or_none(info["wape"], 4),
            "mase": _round_or_none(info["mase"], 3),
            "wape_h1": _round_or_none(info["wape_h"][1], 4),
            "wape_h2": _round_or_none(info["wape_h"][2], 4),
            "wape_h3": _round_or_none(info["wape_h"][3], 4),
            "months": info["months"],
            "avg_tons": round(info["avg_tons"], 1),
            "trained_through": info["trained_through"],
            "interval_level_pct": info["interval_level_pct"],
            "coverage_empirical": _round_or_none(info["coverage_empirical"], 3),
        })
    return {"trained_at": engine["trained_at"], "models": rows}


@router.get("/api/v1/history")
def handle_history(product_id: str = Query(default=None)):
    """Historical monthly tonnage for one grade (the actuals behind the model)."""
    engine = _require_engine()
    grades = engine["grades"]
    if product_id is None:
        product_id = next(iter(grades))
    if product_id not in grades:
        raise HTTPException(
            status_code=404,
            detail={"error": "unknown product_id", "available": sorted(grades)},
        )

    series = engine["series"][product_id]
    return {
        "product_id": product_id,
        "trained_through": grades[product_id]["trained_through"],
        "months": [{"period": str(period), "tons": round(float(tons), 1)}
                   for period, tons in series.items()],
        "avg_tons": round(float(series.mean()), 1),
        "total_tons": round(float(series.sum()), 1),
    }


@router.get("/api/v1/forecast")
def handle_forecast(
    product_id: str = Query(default=None),
    horizon_months: int = Query(default=3, ge=1, le=12),
    demand_change_pct: float = Query(default=0.0),
):
    """Demand forecast for one grade over a horizon (monthly, tons)."""
    from forecasting import service

    if not math.isfinite(demand_change_pct):
        raise HTTPException(status_code=400, detail="demand_change_pct must be a finite number")

    engine = _require_engine()
    grades = engine["grades"]
    if product_id is None:
        product_id = next(iter(grades))
    if product_id not in grades:
        raise HTTPException(
            status_code=404,
            detail={"error": "unknown product_id", "available": sorted(grades)},
        )

    info = grades[product_id]
    result = service.forecast(info, horizon_months, demand_change_pct)
    forecast_rounded = [round(float(v), 1) for v in result["forecast_tons"]]

    return {
        "product_id": product_id,
        "basis": "monthly tonnage from Billing Date, net of returns",
        "trained_through": info["trained_through"],
        "horizon_months": horizon_months,
        "periods": result["periods"],
        "baseline_tons": [round(float(v), 1) for v in result["baseline_tons"]],
        "forecast_tons": forecast_rounded,
        "lower_tons": [round(float(v), 1) for v in result["lower_tons"]],
        "upper_tons": [round(float(v), 1) for v in result["upper_tons"]],
        "total_forecast_tons": round(sum(forecast_rounded), 1),
        "demand_change_pct": demand_change_pct,
        "model_name": info["champion"],
        "interval": {
            "level_pct": info["interval_level_pct"],
            "method": "per-horizon residual-quantile bands from a monthly-stepped backtest; "
                      "beyond it a conservative sqrt(h) extrapolation; band scales with the scenario uplift",
            "coverage_empirical": round(info["coverage_empirical"], 3),
        },
        "metrics": {
            "wape": _round_or_none(info["wape"], 4),
            "mase": _round_or_none(info["mase"], 3),
        },
    }


@router.post("/api/v1/retrain")
def handle_retrain():
    """Refit all champion models from the billing data (runs in seconds)."""
    global forecast_engine
    from forecasting import service
    try:
        engine = service.train_all()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Retrain failed, previous engine kept: %s" % exc,
        )
    forecast_engine = engine
    _training.update(state="idle", started_at=None, error=None)
    _save_cached_engine(engine)
    engine_forecast.publish_after_training(forecast_engine)
    return {
        "status": "retrained",
        "trained_at": forecast_engine["trained_at"],
        "grades": {
            name: {"champion": info["champion"], "wape": round(info["wape"], 4)}
            for name, info in forecast_engine["grades"].items()
        },
        "published": engine_forecast.last_publish(),
    }


@router.post("/api/v1/forecasts/from-engine")
def handle_publish_engine_forecast(dry_run: bool = False):
    """Write the engine's monthly forecast per product group into the planning
    data (Source = 'engine'; a planner's 'manual' row still overrides it).

    Runs on its own after every training when a database is configured;
    this endpoint does it on demand, in memory mode too. dry_run=true
    counts the rows without keeping them.
    """
    engine = _require_engine()
    try:
        return engine_forecast.publish(engine, dry_run=dry_run)
    except WriteRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except StoreUnavailable:
        log.exception("[Database] Planning data: engine forecast NOT published")
        raise HTTPException(status_code=503, detail="Database unavailable: engine forecast NOT published")
