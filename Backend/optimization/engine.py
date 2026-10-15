"""Phase 1 stub engine.

`solve()` answers POST /api/v1/optimize with the hand-built sample plan.
The schedule is fixed, but KPIs and the per-grade fulfillment panel ARE
recomputed from the request's demand, so planner edits on the page have
a visible effect even before the real solver lands.

Phase 2 replaces this module's body with the CP-SAT model (OR-Tools).
The response contract — status / mode / solve_s / grades / demand_used /
kpis / fulfillment / days / pair_notes / checks / assumptions — must not
change, because the page renders straight from it.
"""

import time

from optimization.sample_plan import (
    ASSUMPTIONS,
    CHECKS,
    DAYS,
    DEMAND_DEFAULT,
    GRADES,
    GRADE_ORDER,
    PAIR_NOTES,
    PAIR_STATUS,
)

# RX1+RX2 always act as pair 0, RX3+RX4 as pair 1.
REACTOR_PAIRS = [("RX1", 0), ("RX2", 0), ("RX3", 1), ("RX4", 1)]


def _produced_per_grade() -> dict:
    produced = {g: 0.0 for g in GRADE_ORDER}
    for day in DAYS:
        for grade, tons in zip(day["g"], day["t"]):
            produced[grade] += float(tons)
    return produced


def _fulfillment(demand: dict) -> list:
    produced = _produced_per_grade()
    rows = []
    for grade in GRADE_ORDER:
        prod = produced[grade]
        dem = float(demand[grade])
        rows.append({
            "grade": grade,
            "disp": GRADES[grade]["disp"],
            "slot": GRADES[grade]["slot"],
            "produced": round(prod, 1),
            "demand": round(dem, 1),
            "shortage": round(max(0.0, dem - prod), 1),
        })
    return rows


def solve(req: dict) -> dict:
    started = time.perf_counter()

    # Demand: planner overrides win, otherwise the demo defaults.
    demand = {}
    requested = req.get("demand") or {}
    for grade in GRADE_ORDER:
        value = requested.get(grade)
        demand[grade] = float(value) if value is not None else DEMAND_DEFAULT[grade]

    fulfillment = _fulfillment(demand)
    total_tons = round(sum(float(t) for day in DAYS for t in day["t"]), 1)
    total_demand = sum(r["demand"] for r in fulfillment)
    met = sum(min(r["produced"], r["demand"]) for r in fulfillment)
    shortage = sum(r["shortage"] for r in fulfillment)
    changeover_days = sum(1 for day in DAYS if day["chg"])

    kpis = {
        "status": "Feasible",
        "total_tons": total_tons,
        "fulfillment_pct": round(met / total_demand * 100.0, 1) if total_demand else 0.0,
        "shortage_tons": round(shortage, 1),
        "changeover_days": changeover_days,
        "solve_s": round(time.perf_counter() - started, 3),
    }

    days = []
    for index, day in enumerate(DAYS):
        parts = [{"grade": g, "tons": t} for g, t in zip(day["g"], day["t"])]
        p1, p2 = PAIR_STATUS[index]
        days.append({
            "iso": day["iso"],
            "date": day["date"],
            "wd": day["wd"],
            "wknd": day["wknd"],
            "chg": day["chg"],
            "cap": day["cap"],
            "parts": parts,
            "p1": p1,
            "p2": p2,
            "reactors": [{
                "id": reactor_id,
                "status": (p1, p2)[pair_index],
                "parts": parts if (p1, p2)[pair_index] == "prod" else [],
            } for reactor_id, pair_index in REACTOR_PAIRS],
            "rx": day["rx"],
            "note": day["note"],
        })

    return {
        "status": "feasible",
        "mode": "sample",   # stub flag; Phase 2 sets "cspat"
        "solve_s": kpis["solve_s"],
        "horizon_days": len(DAYS),
        "start_date": DAYS[0]["iso"],
        "grades": [{"id": g, "disp": GRADES[g]["disp"], "slot": GRADES[g]["slot"]}
                   for g in GRADE_ORDER],
        "demand_used": {g: round(demand[g], 1) for g in GRADE_ORDER},
        "kpis": kpis,
        "fulfillment": fulfillment,
        "days": days,
        "pair_notes": PAIR_NOTES,
        "checks": CHECKS,
        "assumptions": ASSUMPTIONS,
    }
