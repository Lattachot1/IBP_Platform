"""Production schedule optimization (CP-SAT) and hand-edited plan checks."""

import math

from fastapi import APIRouter, HTTPException

from optimization import engine as optimization_engine
from optimization import manual as optimization_manual
from optimization.schemas import EvaluateRequest, OptimizeRequest

router = APIRouter(tags=["optimize"])


def _reject_non_finite(values: dict) -> None:
    """Reject NaN/Infinity payloads the way the Go JSON decoder used to
    (HTTP 400), instead of letting them poison the math (which would 500)."""
    for name, value in values.items():
        if isinstance(value, float) and not math.isfinite(value):
            raise HTTPException(
                status_code=400,
                detail="Invalid request payload: field '%s' must be a finite number" % name,
            )


@router.post("/api/v1/optimize")
def handle_optimize(req: OptimizeRequest) -> dict:
    """Production schedule optimization (Phase 1: sample-plan stub).

    The request/response contract is final: the Phase 2 CP-SAT engine
    replaces optimization/engine.solve() without touching this endpoint
    or the /optimize page. Deliberately independent of the forecast
    engine and the database.
    """
    _reject_non_finite({
        ("demand." + grade): value
        for grade, value in (req.demand or {}).items()
    })
    return optimization_engine.solve(req.model_dump())


@router.post("/api/v1/optimize/evaluate")
def handle_optimize_evaluate(req: EvaluateRequest) -> dict:
    """Check a hand-edited plan (editable Gantt) against the plant rules.

    Same scope inputs as /api/v1/optimize plus campaigns, cleanings and the
    reactor-pair plan. Answers in the solver's response shape with
    `checks` of level "conflict" for every broken rule, so the page draws
    the edited plan with the same Gantt and highlights the offending days.
    """
    _reject_non_finite({
        ("demand." + grade): value
        for grade, value in (req.demand or {}).items()
    })
    try:
        return optimization_manual.evaluate(req.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
