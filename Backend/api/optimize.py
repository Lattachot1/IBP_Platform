"""Production schedule optimization (CP-SAT), hand-edited plan checks and
the product catalog the plan form is built from."""

import logging
import math

from fastapi import APIRouter, HTTPException

from optimization import engine as optimization_engine
from optimization import manual as optimization_manual
from optimization.product_split import ProductDemandError
from optimization.schemas import EvaluateRequest, OptimizeRequest
from planning_data import products

log = logging.getLogger("ibp.api.optimize")

router = APIRouter(tags=["optimize"])


@router.get("/api/v1/optimize/catalog")
def handle_catalog() -> dict:
    """The product groups of plant_config.yaml, each with its active products.

    `unassigned` lists active products whose group is no longer in
    plant_config.yaml: they cannot be planned until they are moved to an
    existing group (PATCH /api/v1/products/{material_no}).
    """
    groups = optimization_engine.plant_groups()
    try:
        active = products.get_store().list(active=True)
    except products.StoreUnavailable:
        log.exception("[Database] Products: catalog query failed")
        raise HTTPException(status_code=503, detail="Database unavailable: could not load the product catalog")

    by_group = {g["id"]: dict(g, products=[]) for g in groups}
    unassigned = []
    for product in active:
        entry = {
            "material_no": product.material_no,
            "description": product.description,
            "min_stock_tons": product.min_stock_tons,
        }
        if product.group_code in by_group:
            by_group[product.group_code]["products"].append(entry)
        else:
            unassigned.append(dict(entry, group_code=product.group_code))
    return {"groups": list(by_group.values()), "unassigned": unassigned}


def _reject_non_finite(values: dict) -> None:
    """Reject NaN/Infinity payloads the way the Go JSON decoder used to
    (HTTP 400), instead of letting them poison the math (which would 500)."""
    for name, value in values.items():
        if isinstance(value, float) and not math.isfinite(value):
            raise HTTPException(
                status_code=400,
                detail="Invalid request payload: field '%s' must be a finite number" % name,
            )


def _numbers(req: OptimizeRequest) -> dict:
    values = {("demand." + grade): value for grade, value in (req.demand or {}).items()}
    values.update({("product_demand." + m): value for m, value in (req.product_demand or {}).items()})
    return values


@router.post("/api/v1/optimize")
def handle_optimize(req: OptimizeRequest) -> dict:
    """Production schedule optimization (Phase 1: sample-plan stub).

    The request/response contract is final: the Phase 2 CP-SAT engine
    replaces optimization/engine.solve() without touching this endpoint
    or the /optimize page. Independent of the forecast engine.

    use_planning_data=true plans per product from the planning data
    (stock, QC lots, open orders, monthly forecast; database or the mock
    set in memory mode) instead of `demand`, and adds a `planning` section
    plus `days[].products`. A configured database that is down -> 503.
    """
    _reject_non_finite(_numbers(req))
    try:
        return optimization_engine.solve(req.model_dump())
    except ProductDemandError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except products.StoreUnavailable:
        log.exception("[Database] Planning data: optimize could not load its inputs")
        raise HTTPException(status_code=503, detail="Database unavailable: could not load the planning data")


@router.post("/api/v1/optimize/evaluate")
def handle_optimize_evaluate(req: EvaluateRequest) -> dict:
    """Check a hand-edited plan (editable Gantt) against the plant rules.

    Same scope inputs as /api/v1/optimize plus campaigns, cleanings and the
    reactor-pair plan. Answers in the solver's response shape with
    `checks` of level "conflict" for every broken rule, so the page draws
    the edited plan with the same Gantt and highlights the offending days.
    """
    _reject_non_finite(_numbers(req))
    try:
        return optimization_manual.evaluate(req.model_dump())
    except ProductDemandError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except products.StoreUnavailable:
        log.exception("[Database] Products: evaluate could not load the product master")
        raise HTTPException(status_code=503, detail="Database unavailable: could not load the product master")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
