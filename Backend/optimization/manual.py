"""Manual-plan evaluation — the rule checker behind the editable Gantt.

POST /api/v1/optimize/evaluate takes a campaign sequence (grade + days,
filling the horizon), cleaning windows per reactor pair, the reactor-pair
plan and the same scope inputs as /api/v1/optimize. It expands that to a
day-by-day plan and checks it against every rule in plant_config.yaml —
the same rules the CP-SAT model enforces, with the same semantics:

  - transitions limited to the Allow_GradeChange pairs, changeover-day
    output capped by the pair ceiling (split half/half here)
  - min-run days per campaign (final campaign waived at the horizon end),
    initial campaign governed by `initial.remain_days`
  - VCR campaigns: combined length >= min_total_days (waived when the
    campaign runs to the horizon end), never ending on a weekend/holiday,
    all four reactors running
  - reactor lifecycle: cleaning windows of exactly `cleaning_days`, one
    pair at a time, pair age <= rx12_max_age_days, RX3-4 age <= 15 on the
    first VCR day, RX1-2 age < 50 on the last VCR day (ages are counted
    before that day's production, like the solver's age variables)
  - calendar: grade switches only on weekdays, never on company holidays

The response has the same shape as the solver's so the /optimize page
renders it with the same Gantt; `checks` carries level "conflict" for
broken rules plus the day indexes involved so the page can highlight
them. Rules and figures live in plant_config.yaml only.
"""

from datetime import date, datetime, timedelta

from optimization.engine import (
    SLOT_ORDER,
    WD_NAMES,
    _display,
    _fmt_day,
    _grades_payload,
    _load_config,
    _next_monday,
)
from optimization.sample_plan import DEMAND_DEFAULT

PAIRS = ("RX1-2", "RX3-4")


def _other(pair: str) -> str:
    return PAIRS[1] if pair == PAIRS[0] else PAIRS[0]


def _windows(flags, dates):
    out, d = [], 0
    while d < len(flags):
        if flags[d]:
            s = d
            while d < len(flags) and flags[d]:
                d += 1
            out.append((s, d - 1))
        else:
            d += 1
    return out


def _fmt_window(w, dates):
    return "%s–%s" % (_fmt_day(dates[w[0]]), _fmt_day(dates[w[1]]))


def draft_from_result(res: dict) -> dict:
    """Derive the editable draft (campaigns / cleanings / pair plan) from a
    solver or evaluator response. Mirrors draftFromResult() on the page;
    used by the self-test to prove the evaluator accepts every solver plan.
    """
    days = res.get("days") or []
    mains = []
    for i, d in enumerate(days):
        if not d["parts"]:
            mains.append(mains[-1] if mains else "")
            continue
        mains.append(d["parts"][-1]["grade"] if d["chg"] and len(d["parts"]) > 1 else d["parts"][0]["grade"])
    campaigns = []
    for g in mains:
        if campaigns and campaigns[-1]["grade"] == g:
            campaigns[-1]["days"] += 1
        else:
            campaigns.append({"grade": g, "days": 1})
    # Back-to-back cleaning windows show up as one long run of "clean" days;
    # split every run into windows of cleaning_days (the last one may be cut
    # off by the horizon end).
    try:
        clean_days = int(_load_config()["reactor"]["cleaning_days"])
    except Exception:
        clean_days = 7
    cleanings = []
    for key, pair in (("p1", "RX1-2"), ("p2", "RX3-4")):
        flags = [d.get(key) == "clean" for d in days]
        for s, e in _windows(flags, None):
            for start in range(s, e + 1, clean_days):
                cleanings.append({"pair": pair, "start": start})
    starts, acc = [], 0
    for c in campaigns:
        starts.append(acc)
        acc += c["days"]

    def locate(day):
        for k in range(len(campaigns) - 1, -1, -1):
            if day >= starts[k]:
                return k, min(day - starts[k], campaigns[k]["days"] - 1)
        return 0, 0

    pair_plan = []
    cur = None
    for i, d in enumerate(days):
        p1, p2 = d.get("p1"), d.get("p2")
        if p1 == "prod" and p2 == "prod":
            continue  # VCR day — both pairs by rule, nothing to record
        pair = "RX1-2" if p1 == "prod" else ("RX3-4" if p2 == "prod" else None)
        if pair and pair != cur:
            k, off = locate(i)
            pair_plan.append({"campaign": k, "offset": off, "pair": pair})
            cur = pair
    return {"campaigns": campaigns, "cleanings": cleanings, "pair_plan": pair_plan}


def evaluate(req: dict) -> dict:
    """Entry point used by main.py. Raises ValueError on a malformed draft."""
    return _evaluate(_load_config(), req)


def _evaluate(cfg: dict, req: dict) -> dict:
    grades = list(cfg["grades"].keys())
    caps = {g: int(cfg["grades"][g]["daily_capacity_tons"]) for g in grades}
    min_runs = {g: int(cfg["grades"][g]["min_run_days"]) for g in grades}
    transitions = {(t["from"], t["to"]): int(t["ceiling_tons"]) for t in cfg["transitions"]}
    assumed_pairs = {(t["from"], t["to"]) for t in cfg["transitions"] if t.get("assumed")}
    vcr_grades = {cfg["vcr"]["entry_grade"], cfg["vcr"]["internal_switch"]["to"]}
    vcr_total_min = int(cfg["vcr"]["min_total_days"])
    rx_max_age = int(cfg["reactor"]["rx12_max_age_days"])
    rx12_vcr_end = int(cfg["reactor"]["rx12_max_age_at_vcr_end"])     # strict "<"
    rx34_vcr_max = int(cfg["reactor"]["rx34_max_age_before_vcr"])
    clean_days = int(cfg["reactor"]["cleaning_days"])
    weekdays_only = bool(cfg["calendar"].get("changeover_weekdays_only", True))
    holidays = set(cfg["calendar"].get("company_holidays") or [])
    holidays.update(h for h in (req.get("holidays") or []) if h)

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
    blocked = [d.weekday() >= 5 or d.isoformat() in holidays for d in dates]

    initial = req.get("initial") or {}
    g0 = initial.get("grade") or grades[0]
    remain = max(0, min(int(initial.get("remain_days") or 0), H))
    age0 = {
        "RX1-2": max(0, int(initial.get("rx12_age") or 0)),
        "RX3-4": max(0, int(initial.get("rx34_age") or 0)),
    }

    # ---- expand the draft ---------------------------------------------------
    campaigns = [(c["grade"], int(c["days"])) for c in (req.get("campaigns") or [])]
    if not campaigns:
        raise ValueError("at least one campaign is required")
    for g, n in campaigns:
        if g not in caps:
            raise ValueError("unknown grade %r" % g)
        if n < 1:
            raise ValueError("every campaign needs at least one day")
    total = sum(n for _, n in campaigns)
    if total != H:
        raise ValueError("campaign days add up to %d but the horizon is %d days" % (total, H))
    mains = []
    for g, n in campaigns:
        mains.extend([g] * n)
    chg = [False] + [mains[d] != mains[d - 1] for d in range(1, H)]
    vcr = [g in vcr_grades for g in mains]

    conflicts = []   # {"text", "days"}
    warns = []
    oks = []

    def conflict(text, days=()):
        conflicts.append({"level": "conflict", "text": text, "days": sorted(set(int(d) for d in days))})

    # ---- cleaning windows ---------------------------------------------------
    cl = {p: [False] * H for p in PAIRS}
    for c in req.get("cleanings") or []:
        pair = c["pair"]
        if pair not in cl:
            raise ValueError("unknown reactor pair %r" % pair)
        s = max(0, min(H - 1, int(c["start"])))
        overlap = [j for j in range(s, min(H, s + clean_days)) if cl[pair][j]]
        if overlap:
            conflict("%s has two cleaning windows overlapping on %s" % (pair, _fmt_day(dates[overlap[0]])), overlap)
        for j in range(s, min(H, s + clean_days)):
            cl[pair][j] = True
    both_clean = [d for d in range(H) if cl["RX1-2"][d] and cl["RX3-4"][d]]
    if both_clean:
        conflict("Both reactor pairs are cleaning on %s — only one pair may clean at a time"
                 % _fmt_day(dates[both_clean[0]]), both_clean)

    # ---- which pair produces on BR days: follows the pair plan (anchored
    #      to campaigns), hands over to the other pair while cleaning or
    #      when it would exceed its age limit ------------------------------
    camp_starts, acc = [], 0
    for _g, n in campaigns:
        camp_starts.append(acc)
        acc += n
    segs = []
    for s in req.get("pair_plan") or []:
        k = int(s.get("campaign", 0))
        if 0 <= k < len(campaigns):
            off = max(0, min(int(s.get("offset", 0)), campaigns[k][1] - 1))
            segs.append((camp_starts[k] + off, s["pair"]))
    segs.sort()
    plan_pair, cur, i = [], "RX1-2", 0
    for d in range(H):
        while i < len(segs) and segs[i][0] <= d:
            cur = segs[i][1]
            i += 1
        plan_pair.append(cur)

    # ages = production days since the last cleaning, counted before the
    # day's production exactly like the solver's age variables
    age = {p: [0] * (H + 1) for p in PAIRS}
    for p in PAIRS:
        age[p][0] = min(age0[p], rx_max_age)
    run = {p: [False] * H for p in PAIRS}
    vcr_clean_days = []
    handovers = {p: [] for p in PAIRS}
    for d in range(H):
        if vcr[d]:
            for p in PAIRS:
                if cl[p][d]:
                    vcr_clean_days.append((p, d))
                else:
                    run[p][d] = True
        else:
            p = plan_pair[d]
            o = _other(p)
            if cl[p][d]:
                if not cl[o][d]:
                    run[o][d] = True
            elif age[p][d] + 1 > rx_max_age and not cl[o][d] and age[o][d] + 1 <= rx_max_age:
                # the planned pair is due for cleaning — let the other pair
                # carry the BR grade instead of breaking the age rule
                run[o][d] = True
                handovers[p].append(d)
            else:
                run[p][d] = True
        for p in PAIRS:
            if cl[p][d]:
                age[p][d + 1] = 0
            else:
                age[p][d + 1] = age[p][d] + (1 if run[p][d] else 0)
    if vcr_clean_days:
        by_pair = {}
        for p, d in vcr_clean_days:
            by_pair.setdefault(p, []).append(d)
        for p, ds in by_pair.items():
            conflict("%s is cleaning during the VCR campaign (%s) — VCR needs all four reactors"
                     % (p, _fmt_day(dates[ds[0]])), ds)
    for p in PAIRS:
        over = [d for d in range(H) if age[p][d + 1] > rx_max_age]
        if over:
            conflict("%s reaches age %d on %s — it must be cleaned before %d production days"
                     % (p, age[p][over[0] + 1], _fmt_day(dates[over[0]]), rx_max_age), over)
        if handovers[p]:
            warns.append({"level": "warn", "days": handovers[p],
                          "text": "%s is at its %d-day age limit from %s — %s took over the BR grades; schedule a %s cleaning"
                          % (p, rx_max_age, _fmt_day(dates[handovers[p][0]]), _other(p), p)})

    # ---- campaigns: min-run and initial state --------------------------------
    camps = []
    s = 0
    for d in range(1, H + 1):
        if d == H or mains[d] != mains[d - 1]:
            camps.append((mains[s], s, d - 1))
            s = d
    first_g, first_a, first_b = camps[0]
    if remain > 0 and (first_g != g0 or (first_b - first_a + 1) < remain):
        conflict("The plan must start with %s for %d more day(s) — that campaign still owes its min-run (initial state)"
                 % (_display(g0), remain), range(0, min(remain, H)))
    short_runs = []
    for g, a, b in camps[1:]:
        length = b - a + 1
        if b < H - 1 and length < min_runs[g]:
            short_runs.append((g, a, b, length))
    for g, a, b, length in short_runs:
        conflict("%s campaign %s runs %d day(s) — min-run is %d"
                 % (_display(g), _fmt_window((a, b), dates), length, min_runs[g]), range(a, b + 1))

    # ---- transitions and calendar ------------------------------------------
    chg_list = []
    assumed_used = set()
    for d in range(1, H):
        if not chg[d]:
            continue
        pair = (mains[d - 1], mains[d])
        label = "%s→%s" % (_display(pair[0]), _display(pair[1]))
        chg_list.append(label)
        if pair not in transitions:
            conflict("%s on %s is not in the Allow_GradeChange table" % (label, _fmt_day(dates[d])), [d])
        elif pair in assumed_pairs:
            assumed_used.add(label)
        if weekdays_only and blocked[d]:
            conflict("Grade change %s falls on a weekend/holiday (%s)" % (label, _fmt_day(dates[d])), [d])

    # ---- VCR campaign structure --------------------------------------------
    vcr_blocks = _windows(vcr, dates)
    vcr_days = sum(vcr)
    for a, b in vcr_blocks:
        length = b - a + 1
        if length < vcr_total_min:
            if b < H - 1:
                conflict("VCR campaign %s is %d day(s) — VCR-412 + VCR-617 must total at least %d"
                         % (_fmt_window((a, b), dates), length, vcr_total_min), range(a, b + 1))
            else:
                warns.append({"level": "warn", "days": list(range(a, b + 1)),
                              "text": "VCR campaign runs to the horizon end with %d day(s) so far — it has to continue to %d in the next plan"
                              % (length, vcr_total_min)})
        if blocked[b]:
            conflict("VCR campaign ends on a weekend/holiday (%s) — the switch back to BR150 must land on a weekday"
                     % _fmt_day(dates[b]), [b])
        if age["RX3-4"][a] > rx34_vcr_max:
            conflict("RX3-4 age is %d on the first VCR day (%s) — must be ≤ %d; clean RX3-4 earlier"
                     % (age["RX3-4"][a], _fmt_day(dates[a]), rx34_vcr_max), [a])
        if age["RX1-2"][b] >= rx12_vcr_end:
            conflict("RX1-2 age is %d on the last VCR day (%s) — must be < %d; clean RX1-2 before VCR"
                     % (age["RX1-2"][b], _fmt_day(dates[b]), rx12_vcr_end), [b])

    # ---- production and fulfillment ----------------------------------------
    # Normal days run at full capacity. Changeover days split the pair
    # ceiling like the solver's free split would: at least 1 t for each
    # group, the rest to whichever grade still has the larger shortage
    # (computed after all normal-day output, then day by day in order).
    available = [
        (run["RX1-2"][d] and run["RX3-4"][d]) if vcr[d] else (run["RX1-2"][d] or run["RX3-4"][d])
        for d in range(H)
    ]
    produced = {g: 0 for g in grades}
    day_parts = [None] * H
    for d in range(H):
        if not chg[d]:
            tons = caps[mains[d]] if available[d] else 0
            day_parts[d] = [{"grade": mains[d], "tons": tons}]
            produced[mains[d]] += tons
    for d in range(1, H):
        if not chg[d]:
            continue
        f, t = mains[d - 1], mains[d]
        ceiling = transitions.get((f, t), caps[t])
        if not available[d]:
            out, inc = 0, 0
        elif ceiling <= 2:
            out, inc = min(1, ceiling), max(0, ceiling - 1)
        else:
            rest = ceiling - 2
            short_f = max(0, demand[f] - produced[f])
            short_t = max(0, demand[t] - produced[t])
            give_f = min(rest, short_f) if short_f >= short_t else rest - min(rest, short_t)
            out, inc = 1 + give_f, ceiling - 1 - give_f
        day_parts[d] = [{"grade": f, "tons": out}, {"grade": t, "tons": inc}]
        produced[f] += out
        produced[t] += inc

    days = []
    conflict_days = {}
    for c in conflicts:
        for d in c["days"]:
            conflict_days.setdefault(d, []).append(c["text"])
    for d in range(H):
        dd = dates[d]
        cur_g = mains[d]
        notes = []
        parts = day_parts[d]
        if chg[d]:
            f = mains[d - 1]
            cap = transitions.get((f, cur_g), caps[cur_g])
            notes.append("Changeover %s→%s" % (_display(f), _display(cur_g)))
            if available[d]:
                parts = [p for p in parts if p["tons"] > 0] or [{"grade": cur_g, "tons": 0}]
        else:
            cap = None
        if not available[d]:
            notes.append("No reactor pair available — no output credited")
        if vcr[d] and (d == 0 or not vcr[d - 1]):
            notes.append("VCR campaign starts")
        if vcr[d] and (d == H - 1 or not vcr[d + 1]):
            notes.append("VCR campaign ends")
        for p, key in (("RX1-2", "RX1-2"), ("RX3-4", "RX3-4")):
            if cl[p][d] and (d == 0 or not cl[p][d - 1]):
                notes.append("%s cleaning starts (%d days)" % (key, clean_days))
        p1s = "prod" if run["RX1-2"][d] else ("clean" if cl["RX1-2"][d] else "idle")
        p2s = "prod" if run["RX3-4"][d] else ("clean" if cl["RX3-4"][d] else "idle")
        parts_prod = parts if available[d] else []
        if d in conflict_days:
            notes.append("⚠ " + " · ".join(conflict_days[d]))
        days.append({
            "iso": dd.isoformat(),
            "date": _fmt_day(dd),
            "wd": WD_NAMES[dd.weekday()],
            "wknd": dd.weekday() >= 5,
            "chg": chg[d],
            "cap": cap if chg[d] else None,
            "parts": parts,
            "p1": p1s,
            "p2": p2s,
            "reactors": [{
                "id": rid,
                "status": (p1s, p2s)[pi],
                "parts": parts_prod if (p1s, p2s)[pi] == "prod" else [],
            } for rid, pi in [("RX1", 0), ("RX2", 0), ("RX3", 1), ("RX4", 1)]],
            "rx": "RX1-4" if vcr[d] else ("RX1-2" if run["RX1-2"][d] else ("RX3-4" if run["RX3-4"][d] else "—")),
            "note": " · ".join(notes),
            "conflict": d in conflict_days,
        })

    fulfillment = []
    for g in grades:
        fulfillment.append({
            "grade": g,
            "disp": _display(g),
            "slot": SLOT_ORDER.index(g) + 1 if g in SLOT_ORDER else len(grades) + 1,
            "produced": produced[g],
            "demand": demand[g],
            "shortage": max(0, demand[g] - produced[g]),
        })

    # ---- report ---------------------------------------------------------------
    if chg_list:
        bad = {c["text"] for c in conflicts if "Allow_GradeChange" in c["text"]}
        if not bad:
            oks.append({"level": "ok", "text": "%d changeovers, all in the Allow_GradeChange table: %s"
                        % (len(chg_list), ", ".join(chg_list))})
    else:
        oks.append({"level": "ok", "text": "No changeover in this plan"})
    oks.append({"level": "ok", "text": "Campaigns: " + " · ".join(
        "%s %dd (min %d)" % (_display(g), b - a + 1, min_runs[g]) for g, a, b in camps)})
    if vcr_days:
        oks.append({"level": "ok", "text": "VCR: %d day(s) across %d campaign(s) (≥ %d required) · RX3-4 age at start: %s · RX1-2 age at end: %s"
                    % (vcr_days, len(vcr_blocks), vcr_total_min,
                       [age["RX3-4"][a] for a, _ in vcr_blocks], [age["RX1-2"][b] for _, b in vcr_blocks])})
    else:
        oks.append({"level": "ok", "text": "No VCR campaign scheduled — age gates not triggered"})
    oks.append({"level": "ok", "text": "Cleanings — RX1-2: %s · RX3-4: %s" % (
        " and ".join(_fmt_window(w, dates) for w in _windows(cl["RX1-2"], dates)) or "none",
        " and ".join(_fmt_window(w, dates) for w in _windows(cl["RX3-4"], dates)) or "none")})
    oks.append({"level": "ok", "text": "RX1-2 max age in plan: %d days (≤ %d) · RX3-4 max age: %d"
                % (max(age["RX1-2"]), rx_max_age, max(age["RX3-4"]))})
    if any(chg) and not any("weekend/holiday" in c["text"] and "Grade change" in c["text"] for c in conflicts):
        oks.append({"level": "ok", "text": "All grade switches fall on weekdays, none on holidays"})
    if assumed_used:
        warns.append({"level": "warn", "text": "Assumed −5 t losses applied to: %s" % ", ".join(sorted(assumed_used))})
    short_rows = [r for r in fulfillment if r["shortage"] > 0]
    if short_rows:
        warns.append({"level": "warn", "text": "Demand not fully met: "
                      + ", ".join("%s short %d t" % (r["disp"], r["shortage"]) for r in short_rows)})
    else:
        oks.append({"level": "ok", "text": "Demand fully met for all grades"})

    pair_notes = {}
    for p in PAIRS:
        windows = [_fmt_window(w, dates) for w in _windows(cl[p], dates)]
        base = ("Cleaning: " + " and ".join(windows)) if windows else "No cleaning in this horizon"
        pair_notes[p] = "%s · age at plan end: %d days" % (base, age[p][H])

    total_tons = sum(produced.values())
    total_demand = sum(demand.values())
    met = sum(min(produced[g], demand[g]) for g in grades)
    n_conf = len(conflicts)
    kpis = {
        "status": "Manual · no rule conflicts" if n_conf == 0 else "Manual · %d rule conflict%s" % (n_conf, "" if n_conf == 1 else "s"),
        "total_tons": total_tons,
        "fulfillment_pct": round(met / total_demand * 100.0, 1) if total_demand else 0.0,
        "shortage_tons": sum(r["shortage"] for r in fulfillment),
        "changeover_days": sum(chg),
        "solve_s": 0.0,
    }

    return {
        "status": "feasible" if n_conf == 0 else "conflicts",
        "mode": "manual",
        "conflicts": n_conf,
        "solve_s": 0.0,
        "horizon_days": H,
        "start_date": dates[0].isoformat(),
        "grades": _grades_payload(cfg),
        "demand_used": {g: demand[g] for g in grades},
        "kpis": kpis,
        "fulfillment": fulfillment,
        "days": days,
        "pair_notes": pair_notes,
        "checks": conflicts + warns + oks,
        "assumptions": cfg.get("assumptions") or [],
    }
