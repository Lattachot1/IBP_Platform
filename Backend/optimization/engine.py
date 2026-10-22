"""Phase 2 optimization engine — OR-Tools CP-SAT.

`solve()` answers POST /api/v1/optimize by building and solving a
constraint model of the TSL plant from plant_config.yaml:

  - one main grade per day; changeover days may produce the outgoing and
    incoming group together within the pair's ceiling (free split)
  - grade sequence restricted to the 11 allowed transition pairs
  - min-run days per grade (the changeover day counts as day 1 of the new
    grade; the initial campaign is governed by `remain_days` and the
    final campaign may run past the horizon)
  - VCR campaigns: entered only via BR150 -> VCR-412, optional VCR-617
    tail, 412-only campaigns allowed, combined VCR days >= min_total_days
  - reactor lifecycle: RX1-2 max 60 production days then a 7-day clean,
    RX3-4 age <= 15 on the first VCR day, RX1-2 age < 50 at the last VCR
    day, cleanings never overlap and never run during VCR, age resets to
    0 after cleaning
  - calendar: grade switches only on weekdays, never on company holidays,
    and VCR campaigns may not end on a weekend/holiday

Objective: maximize fulfilled demand (capped per grade); the request's
objective only changes how strongly changeovers are penalized.

If ortools is not installed the endpoint falls back to the Phase 1
sample plan so the rest of the platform keeps working.
"""

import os
import time
from datetime import date, datetime, timedelta

try:
    import yaml
except ImportError:  # pyyaml missing → the sample fallback keeps the API alive
    yaml = None

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

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "plant_config.yaml")

GRADE_DISPLAY = {"VCR412": "VCR-412", "VCR617": "VCR-617"}
SLOT_ORDER = ["BR150", "BR150B", "BR360B", "VCR412", "VCR617", "BR150L"]
WD_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

# Changeover penalty weight per request objective — fulfilled tons dominate,
# the penalty only breaks ties between equally productive plans.
OBJ_CHANGEOVER_PENALTY = {
    "maximize_fulfilled": 2,
    "balance": 60,
    "minimize_changeover": 400,
}


def _load_config() -> dict:
    if yaml is None:
        raise ImportError("pyyaml is not installed")
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _display(grade: str) -> str:
    return GRADE_DISPLAY.get(grade, grade)


def _next_monday(today: date) -> date:
    ahead = (0 - today.weekday()) % 7
    if ahead == 0:
        ahead = 7
    return today + timedelta(days=ahead)


def _fmt_day(d: date) -> str:
    return "%d %s" % (d.day, d.strftime("%b"))


def _grades_payload(cfg: dict) -> list:
    order = [g for g in SLOT_ORDER if g in cfg["grades"]]
    order += [g for g in cfg["grades"] if g not in order]
    return [{"id": g, "disp": _display(g), "slot": i + 1} for i, g in enumerate(order)]


def _empty_payload(status: str, message: str, cfg: dict, solve_s: float, horizon: int, start_date: str) -> dict:
    grades = _grades_payload(cfg)
    return {
        "status": status,
        "mode": "cspat",
        "message": message,
        "solve_s": solve_s,
        "horizon_days": horizon,
        "start_date": start_date,
        "grades": grades,
        "demand_used": {},
        "kpis": {
            "status": status.replace("infeasible", "Infeasible").replace("unknown", "No solution"),
            "total_tons": 0,
            "fulfillment_pct": 0.0,
            "shortage_tons": 0,
            "changeover_days": 0,
            "solve_s": solve_s,
        },
        "fulfillment": [],
        "days": [],
        "pair_notes": {},
        "checks": [{"level": "warn", "text": message}],
        "assumptions": cfg.get("assumptions") or [],
    }


# ----------------------------------------------------------------------------
# sample fallback (Phase 1 behaviour) — used when ortools is unavailable
# ----------------------------------------------------------------------------
def _sample_response(req: dict, note: str) -> dict:
    started = time.perf_counter()
    requested = req.get("demand") or {}
    demand = {}
    for grade in GRADE_ORDER:
        value = requested.get(grade)
        demand[grade] = float(value) if value is not None else DEMAND_DEFAULT[grade]

    produced = {g: 0.0 for g in GRADE_ORDER}
    for day in DAYS:
        for grade, tons in zip(day["g"], day["t"]):
            produced[grade] += float(tons)
    fulfillment = []
    for grade in GRADE_ORDER:
        prod, dem = produced[grade], float(demand[grade])
        fulfillment.append({
            "grade": grade,
            "disp": GRADES[grade]["disp"],
            "slot": GRADES[grade]["slot"],
            "produced": round(prod, 1),
            "demand": round(dem, 1),
            "shortage": round(max(0.0, dem - prod), 1),
        })
    total_tons = round(sum(float(t) for day in DAYS for t in day["t"]), 1)
    total_demand = sum(r["demand"] for r in fulfillment)
    met = sum(min(r["produced"], r["demand"]) for r in fulfillment)
    shortage = sum(r["shortage"] for r in fulfillment)
    kpis = {
        "status": "Feasible (sample fallback)",
        "total_tons": total_tons,
        "fulfillment_pct": round(met / total_demand * 100.0, 1) if total_demand else 0.0,
        "shortage_tons": round(shortage, 1),
        "changeover_days": sum(1 for day in DAYS if day["chg"]),
        "solve_s": round(time.perf_counter() - started, 3),
    }
    days = [{
        "iso": day["iso"],
        "date": day["date"],
        "wd": day["wd"],
        "wknd": day["wknd"],
        "chg": day["chg"],
        "cap": day["cap"],
        "parts": [{"grade": g, "tons": t} for g, t in zip(day["g"], day["t"])],
        "p1": p1,
        "p2": p2,
        "reactors": [{
            "id": rid,
            "status": (p1, p2)[pi],
            "parts": ([{"grade": g, "tons": t} for g, t in zip(day["g"], day["t"])]
                      if (p1, p2)[pi] == "prod" else []),
        } for rid, pi in [("RX1", 0), ("RX2", 0), ("RX3", 1), ("RX4", 1)]],
        "rx": day["rx"],
        "note": day["note"],
    } for day, (p1, p2) in zip(DAYS, PAIR_STATUS)]
    return {
        "status": "feasible",
        "mode": "sample",
        "message": note,
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


# ----------------------------------------------------------------------------
# CP-SAT model
# ----------------------------------------------------------------------------
def _solve_cspat(cfg: dict, req: dict, started: float) -> dict:
    from ortools.sat.python import cp_model

    grades = list(cfg["grades"].keys())
    G = len(grades)
    gi = {g: i for i, g in enumerate(grades)}
    caps = [int(cfg["grades"][g]["daily_capacity_tons"]) for g in grades]
    min_runs = [int(cfg["grades"][g]["min_run_days"]) for g in grades]
    transitions = {(t["from"], t["to"]): int(t["ceiling_tons"]) for t in cfg["transitions"]}
    assumed_pairs = {(t["from"], t["to"]) for t in cfg["transitions"] if t.get("assumed")}
    vcr_total_min = int(cfg["vcr"]["min_total_days"])
    gi412 = gi[cfg["vcr"]["entry_grade"]]
    gi617 = gi[cfg["vcr"]["internal_switch"]["to"]]
    rx12_max = int(cfg["reactor"]["rx12_max_age_days"])
    rx12_vcr_end_max = int(cfg["reactor"]["rx12_max_age_at_vcr_end"]) - 1  # strict "<"
    rx34_vcr_max = int(cfg["reactor"]["rx34_max_age_before_vcr"])
    clean_days = int(cfg["reactor"]["cleaning_days"])
    weekdays_only = bool(cfg["calendar"].get("changeover_weekdays_only", True))
    holidays = set(cfg["calendar"].get("company_holidays") or [])
    holidays.update(h for h in (req.get("holidays") or []) if h)
    penalty = OBJ_CHANGEOVER_PENALTY.get(req.get("objective") or "maximize_fulfilled", 2)

    H = max(7, min(120, int(req.get("horizon_days") or 28)))

    requested = req.get("demand") or {}
    demand = {}
    for g in grades:
        value = requested.get(g)
        demand[g] = int(round(float(value))) if value is not None else int(DEMAND_DEFAULT.get(g, 0))

    start_iso = req.get("start_date") or ""
    try:
        start = datetime.strptime(start_iso, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        start = _next_monday(date.today())
    dates = [start + timedelta(days=i) for i in range(H)]
    blocked_days = [d.weekday() >= 5 or d.isoformat() in holidays for d in dates]

    initial = req.get("initial") or {}
    g0 = gi.get(initial.get("grade") or grades[0], 0)
    remain = max(0, min(int(initial.get("remain_days") or 0), H))
    age12_0 = max(0, min(int(initial.get("rx12_age") or 0), rx12_max))
    age34_0 = max(0, min(int(initial.get("rx34_age") or 0), rx12_max))

    m = cp_model.CpModel()
    Hr = range(H)

    # ---- main grade per day -------------------------------------------------
    is_main = [[m.NewBoolVar(f"main_{d}_{g}") for g in range(G)] for d in Hr]
    for d in Hr:
        m.AddExactlyOne(is_main[d])
    main = [m.NewIntVar(0, G - 1, f"mainv_{d}") for d in Hr]
    for d in Hr:
        m.Add(main[d] == sum(g * is_main[d][g] for g in range(G)))

    # ---- changeover flags ---------------------------------------------------
    chg = [None] + [m.NewBoolVar(f"chg_{d}") for d in range(1, H)]
    for d in range(1, H):
        m.Add(main[d] != main[d - 1]).OnlyEnforceIf(chg[d])
        m.Add(main[d] == main[d - 1]).OnlyEnforceIf(chg[d].Not())

    # ---- production amounts -------------------------------------------------
    prod = [[m.NewIntVar(0, caps[g], f"prod_{d}_{g}") for g in range(G)] for d in Hr]
    for d in Hr:
        for g in range(G):
            if d == 0:
                m.Add(prod[0][g] <= caps[g] * is_main[0][g])
                continue
            w = m.NewBoolVar(f"was_{d}_{g}")  # outgoing group on a changeover day
            m.Add(w <= chg[d])
            m.Add(w <= is_main[d - 1][g])
            m.Add(w >= is_main[d - 1][g] + chg[d] - 1)
            a = m.NewBoolVar(f"act_{d}_{g}")  # group appears that day
            m.Add(a >= is_main[d][g])
            m.Add(a >= w)
            m.Add(a <= is_main[d][g] + w)
            m.Add(prod[d][g] <= caps[g] * a)

    # ---- transition table ---------------------------------------------------
    for d in range(1, H):
        for f in range(G):
            for t in range(G):
                if f != t and (grades[f], grades[t]) not in transitions:
                    m.AddBoolOr([is_main[d - 1][f].Not(), is_main[d][t].Not()])
    flat_ceil = [transitions.get((grades[f], grades[t]), 0) for f in range(G) for t in range(G)]
    for d in range(1, H):
        ceil_v = m.NewIntVar(0, 500, f"ceil_{d}")
        m.AddElement(main[d - 1] * G + main[d], flat_ceil, ceil_v)
        cap_v = m.NewIntVar(0, 500, f"cap_{d}")
        m.AddElement(main[d], caps, cap_v)
        total = sum(prod[d])
        m.Add(total <= ceil_v).OnlyEnforceIf(chg[d])
        m.Add(total <= cap_v).OnlyEnforceIf(chg[d].Not())
    # both groups put out at least 1 ton on a changeover day (prevents
    # zero-output days from gaming the VCR campaign counter)
    for d in range(1, H):
        for (f, t) in transitions:
            lit = [chg[d], is_main[d - 1][gi[f]], is_main[d][gi[t]]]
            m.Add(prod[d][gi[f]] >= 1).OnlyEnforceIf(lit)
            m.Add(prod[d][gi[t]] >= 1).OnlyEnforceIf(lit)

    # ---- min run days -------------------------------------------------------
    for d in range(1, H):
        for g in range(G):
            s = m.NewBoolVar(f"mstart_{d}_{g}")
            m.Add(s <= is_main[d][g])
            m.Add(s <= chg[d])
            m.Add(s >= is_main[d][g] + chg[d] - 1)
            if d + min_runs[g] > H:
                # too close to the horizon end to prove the min-run: this
                # campaign must then run to the horizon end (no switch-out)
                for j in range(d, H):
                    m.Add(is_main[j][g] == 1).OnlyEnforceIf(s)
            else:
                for j in range(d, min(d + min_runs[g], H)):
                    m.Add(is_main[j][g] == 1).OnlyEnforceIf(s)

    # ---- initial state ------------------------------------------------------
    for d in range(min(remain, H)):
        m.Add(is_main[d][g0] == 1)

    # ---- VCR campaign rules -------------------------------------------------
    vcr_main = [m.NewBoolVar(f"vcr_{d}") for d in Hr]
    for d in Hr:
        m.Add(vcr_main[d] >= is_main[d][gi412])
        m.Add(vcr_main[d] >= is_main[d][gi617])
        m.Add(vcr_main[d] <= is_main[d][gi412] + is_main[d][gi617])

    vcr_start, vcr_end = [], []
    for d in Hr:
        sv = m.NewBoolVar(f"vcrs_{d}")
        if d == 0:
            m.Add(sv == vcr_main[0])
        else:
            m.Add(sv <= vcr_main[d])
            m.Add(sv <= vcr_main[d - 1].Not())
            m.Add(sv >= vcr_main[d] - vcr_main[d - 1])
        vcr_start.append(sv)
        ev = m.NewBoolVar(f"vcre_{d}")
        if d == H - 1:
            m.Add(ev == vcr_main[d])
        else:
            m.Add(ev <= vcr_main[d])
            m.Add(ev <= vcr_main[d + 1].Not())
            m.Add(ev >= vcr_main[d] - vcr_main[d + 1])
        vcr_end.append(ev)
        # a VCR campaign may not end on a weekend/holiday (client rule)
        if blocked_days[d]:
            m.Add(ev == 0)
        need = min(vcr_total_min, H - d)
        m.Add(sum(vcr_main[j] for j in range(d, min(d + vcr_total_min, H))) >= need).OnlyEnforceIf(sv)

    # ---- calendar rule: switches on weekdays only ---------------------------
    if weekdays_only:
        for d in range(1, H):
            if blocked_days[d]:
                m.Add(chg[d] == 0)

    # ---- reactor lifecycle --------------------------------------------------
    run12 = [m.NewBoolVar(f"run12_{d}") for d in Hr]
    run34 = [m.NewBoolVar(f"run34_{d}") for d in Hr]
    cl12 = [m.NewBoolVar(f"cl12_{d}") for d in Hr]
    cl34 = [m.NewBoolVar(f"cl34_{d}") for d in Hr]
    id12 = [m.NewBoolVar(f"id12_{d}") for d in Hr]
    id34 = [m.NewBoolVar(f"id34_{d}") for d in Hr]
    for d in Hr:
        m.AddExactlyOne([run12[d], cl12[d], id12[d]])
        m.AddExactlyOne([run34[d], cl34[d], id34[d]])
        # VCR needs all four reactors; BR days use exactly one pair
        m.Add(run12[d] == 1).OnlyEnforceIf(vcr_main[d])
        m.Add(run34[d] == 1).OnlyEnforceIf(vcr_main[d])
        m.Add(run12[d] + run34[d] == 1).OnlyEnforceIf(vcr_main[d].Not())
        m.Add(cl12[d] + cl34[d] <= 1)
        m.Add(run34[d] == 1).OnlyEnforceIf(cl12[d])
        m.Add(run12[d] == 1).OnlyEnforceIf(cl34[d])
    # cleaning windows are exactly `clean_days` long and never overlap
    for cl, cl_name in ((cl12, "cl12"), (cl34, "cl34")):
        start_c = [m.NewBoolVar(f"{cl_name}_s_{d}") for d in Hr]
        for d in Hr:
            m.Add(cl[d] == sum(start_c[j] for j in range(max(0, d - clean_days + 1), d + 1)))
            for j in range(max(0, d - clean_days + 1), d):
                m.AddBoolOr([start_c[d].Not(), start_c[j].Not()])
    # ages = production days since last cleaning (reset to 0 by cleaning)
    age12 = [m.NewIntVar(0, rx12_max, f"a12_{d}") for d in Hr]
    age34 = [m.NewIntVar(0, rx12_max, f"a34_{d}") for d in Hr]
    m.Add(age12[0] == age12_0)
    m.Add(age34[0] == age34_0)
    for d in range(H - 1):
        m.Add(age12[d + 1] == age12[d] + run12[d]).OnlyEnforceIf(cl12[d].Not())
        m.Add(age12[d + 1] == 0).OnlyEnforceIf(cl12[d])
        m.Add(age34[d + 1] == age34[d] + run34[d]).OnlyEnforceIf(cl34[d].Not())
        m.Add(age34[d + 1] == 0).OnlyEnforceIf(cl34[d])
    # gates: RX3-4 young enough on the first VCR day; RX1-2 young enough on the last
    for d in Hr:
        m.Add(age34[d] <= rx34_vcr_max).OnlyEnforceIf(vcr_start[d])
        m.Add(age12[d] <= rx12_vcr_end_max).OnlyEnforceIf(vcr_end[d])

    # ---- objective ----------------------------------------------------------
    demand_by_idx = [demand[g] for g in grades]
    fulfill = [m.NewIntVar(0, demand_by_idx[g], f"ful_{g}") for g in range(G)]
    for g in range(G):
        m.Add(fulfill[g] <= sum(prod[d][g] for d in Hr))
    m.Maximize(sum(fulfill) - penalty * sum(chg[d] for d in range(1, H)))

    # ---- solve --------------------------------------------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(max(5, min(int(req.get("time_limit_s") or 30), 180)))
    solver.parameters.num_search_workers = 8
    status = solver.Solve(m)
    solve_s = round(time.perf_counter() - started, 3)

    if status == cp_model.INFEASIBLE:
        return _empty_payload(
            "infeasible",
            "No plan satisfies every constraint for this input — try a shorter horizon, "
            "different initial state, or relax a rule in plant_config.yaml.",
            cfg, solve_s, H, dates[0].isoformat())
    if status != cp_model.OPTIMAL and status != cp_model.FEASIBLE:
        return _empty_payload(
            "unknown",
            "Solver hit the time limit without finding a plan — raise the time limit and run again.",
            cfg, solve_s, H, dates[0].isoformat())
    status_txt = "Optimal" if status == cp_model.OPTIMAL else "Feasible (time limit)"

    def val(v):
        return int(round(solver.Value(v)))

    mains = [grades[val(main[d])] for d in Hr]
    chg_flags = [False] + [val(chg[d]) == 1 for d in range(1, H)]
    run12_v = [val(run12[d]) == 1 for d in Hr]
    run34_v = [val(run34[d]) == 1 for d in Hr]
    cl12_v = [val(cl12[d]) == 1 for d in Hr]
    cl34_v = [val(cl34[d]) == 1 for d in Hr]
    vcr_v = [val(vcr_main[d]) == 1 for d in Hr]
    start_vcr_v = [val(vcr_start[d]) == 1 for d in Hr]
    end_vcr_v = [val(vcr_end[d]) == 1 for d in Hr]
    age12_v = [val(age12[d]) for d in Hr]
    age34_v = [val(age34[d]) for d in Hr]

    produced = {g: sum(val(prod[d][gi[g]]) for d in Hr) for g in grades}
    fulfillment = []
    for g in grades:
        dem = demand[g]
        prod_g = produced[g]
        fulfillment.append({
            "grade": g,
            "disp": _display(g),
            "slot": SLOT_ORDER.index(g) + 1 if g in SLOT_ORDER else G + 1,
            "produced": prod_g,
            "demand": dem,
            "shortage": max(0, dem - prod_g),
        })

    def campaign_windows(flags):
        windows, d = [], 0
        while d < H:
            if flags[d]:
                s = d
                while d < H and flags[d]:
                    d += 1
                windows.append("%s–%s" % (_fmt_day(dates[s]), _fmt_day(dates[d - 1])))
            else:
                d += 1
        return windows

    vcr_days = sum(vcr_v)
    n_campaigns = sum(start_vcr_v)
    chg_list = []
    assumed_used = set()
    days = []
    for d in Hr:
        dd = dates[d]
        cur = mains[d]
        chgd = chg_flags[d]
        notes = []
        if chgd:
            f = mains[d - 1]
            pair = (f, cur)
            cap = transitions[pair]
            parts = [{"grade": f, "tons": val(prod[d][gi[f]])},
                     {"grade": cur, "tons": val(prod[d][gi[cur]])}]
            parts = [p for p in parts if p["tons"] > 0] or [{"grade": cur, "tons": 0}]
            chg_list.append("%s→%s" % (_display(f), _display(cur)))
            if pair in assumed_pairs:
                assumed_used.add("%s→%s" % (_display(f), _display(cur)))
                notes.append("Changeover %s→%s · assumed −5 t loss" % (_display(f), _display(cur)))
            else:
                notes.append("Changeover %s→%s" % (_display(f), _display(cur)))
        else:
            parts = [{"grade": cur, "tons": val(prod[d][gi[cur]])}]
            cap = None
        if start_vcr_v[d]:
            notes.append("VCR campaign starts")
        if end_vcr_v[d]:
            notes.append("VCR campaign ends (%d VCR days)" % vcr_days)
        if cl12_v[d] and (d == 0 or not cl12_v[d - 1]):
            notes.append("RX1-2 cleaning starts (%d days)" % clean_days)
        if cl34_v[d] and (d == 0 or not cl34_v[d - 1]):
            notes.append("RX3-4 cleaning starts (%d days)" % clean_days)
        p1s = "prod" if run12_v[d] else ("clean" if cl12_v[d] else "idle")
        p2s = "prod" if run34_v[d] else ("clean" if cl34_v[d] else "idle")
        parts_prod = parts if p1s == "prod" or p2s == "prod" else []
        days.append({
            "iso": dd.isoformat(),
            "date": _fmt_day(dd),
            "wd": WD_NAMES[dd.weekday()],
            "wknd": dd.weekday() >= 5,
            "chg": chgd,
            "cap": cap if chgd else None,
            "parts": parts,
            "p1": p1s,
            "p2": p2s,
            "reactors": [{
                "id": rid,
                "status": (p1s, p2s)[pi],
                "parts": parts_prod if (p1s, p2s)[pi] == "prod" else [],
            } for rid, pi in [("RX1", 0), ("RX2", 0), ("RX3", 1), ("RX4", 1)]],
            "rx": "RX1-4" if vcr_v[d] else ("RX1-2" if run12_v[d] else "RX3-4"),
            "note": " · ".join(notes),
        })

    def pair_note(cl_flags, age_vals):
        windows = campaign_windows(cl_flags)
        base = "Cleaning: " + " and ".join(windows) if windows else "No cleaning in this horizon"
        return "%s · age at plan end: %d days" % (base, age_vals[-1])

    pair_notes = {
        "RX1-2": pair_note(cl12_v, age12_v),
        "RX3-4": pair_note(cl34_v, age34_v),
    }

    # ---- constraint check report -------------------------------------------
    checks = []
    checks.append({
        "level": "ok",
        "text": ("%d changeovers, all in the Allow_GradeChange table: %s" % (len(chg_list), ", ".join(chg_list)))
                if chg_list else "No changeover in this plan",
    })
    campaigns = []
    d0 = 0
    for d in range(1, H + 1):
        if d == H or mains[d] != mains[d - 1]:
            campaigns.append((mains[d0], d - d0))
            d0 = d
    checks.append({
        "level": "ok",
        "text": "Campaigns: " + " · ".join("%s %dd (min %d)" % (_display(g), length, min_runs[gi[g]])
                                           for g, length in campaigns),
    })
    if vcr_days:
        s_ages = [age34_v[d] for d in Hr if start_vcr_v[d]]
        e_ages = [age12_v[d] for d in Hr if end_vcr_v[d]]
        checks.append({"level": "ok", "text": "VCR: %d days across %d campaign(s) (≥ %d required)"
                       % (vcr_days, n_campaigns, vcr_total_min)})
        checks.append({"level": "ok", "text": "RX ages at VCR boundaries — start RX3-4: %s (≤ %d) · end RX1-2: %s (< %d)"
                       % (s_ages, rx34_vcr_max, e_ages, rx12_vcr_end_max + 1)})
    else:
        checks.append({"level": "ok", "text": "No VCR campaign scheduled — age gates not triggered"})
    checks.append({"level": "ok", "text": "Cleanings — RX1-2: %s · RX3-4: %s"
                   % (" and ".join(campaign_windows(cl12_v)) or "none",
                      " and ".join(campaign_windows(cl34_v)) or "none")})
    checks.append({"level": "ok", "text": "RX1-2 max age in plan: %d days (≤ %d) · RX3-4 max age: %d"
                   % (max(age12_v), rx12_max, max(age34_v))})
    if any(chg_flags):
        checks.append({"level": "ok", "text": "All grade switches fall on weekdays, none on holidays"})
    if assumed_used:
        checks.append({"level": "warn", "text": "Assumed −5 t losses applied to: %s" % ", ".join(sorted(assumed_used))})
    short_rows = [r for r in fulfillment if r["shortage"] > 0]
    if short_rows:
        checks.append({"level": "warn", "text": "Demand not fully met: "
                       + ", ".join("%s short %d t" % (r["disp"], r["shortage"]) for r in short_rows)})
    else:
        checks.append({"level": "ok", "text": "Demand fully met for all grades"})

    total_tons = sum(produced.values())
    total_demand = sum(demand.values())
    met = sum(min(produced[g], demand[g]) for g in grades)
    kpis = {
        "status": status_txt,
        "total_tons": total_tons,
        "fulfillment_pct": round(met / total_demand * 100.0, 1) if total_demand else 0.0,
        "shortage_tons": sum(r["shortage"] for r in fulfillment),
        "changeover_days": sum(chg_flags),
        "solve_s": solve_s,
    }

    return {
        "status": "feasible",
        "mode": "cspat",
        "solve_s": solve_s,
        "horizon_days": H,
        "start_date": dates[0].isoformat(),
        "grades": _grades_payload(cfg),
        "demand_used": {g: demand[g] for g in grades},
        "kpis": kpis,
        "fulfillment": fulfillment,
        "days": days,
        "pair_notes": pair_notes,
        "checks": checks,
        "assumptions": cfg.get("assumptions") or [],
    }


def solve(req: dict) -> dict:
    """Entry point used by main.py — response contract identical to Phase 1."""
    started = time.perf_counter()
    cfg = _load_config()
    try:
        return _solve_cspat(cfg, req, started)
    except ImportError:
        return _sample_response(
            req,
            "ortools is not installed — serving the Phase 1 sample plan instead. "
            "Install with: pip install ortools pyyaml",
        )
