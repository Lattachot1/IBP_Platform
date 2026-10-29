"""Self-test for the CP-SAT engine.

Runs several optimization scenarios and validates each solution against
the rules in plant_config.yaml — independent of the solver's own logic:

  python selftest.py            (from Backend/)

Checks per scenario: allowed transitions, changeover-day ceilings, daily
caps, weekday switch rule, min-run days (final campaign waived), VCR
campaign structure (entry, order, combined length), reactor pairing and
cleaning windows, reactor ages (60 / <50 at VCR end / <=15 at VCR start),
and fulfillment figures.
"""

import sys
from datetime import datetime

from optimization import manual
from optimization.engine import _load_config, solve
from optimization.schemas import OptimizeRequest

sys.stdout.reconfigure(encoding="utf-8")

FAILURES = []


def check(name, ok, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  — " + str(detail)) if detail else ""))
    if not ok:
        FAILURES.append((name, detail))


def validate(label, res, cfg, req):
    grades = [g["id"] for g in res["grades"]]
    days = res["days"]
    H = len(days)
    transitions = {(t["from"], t["to"]): t["ceiling_tons"] for t in cfg["transitions"]}
    caps = {g: cfg["grades"][g]["daily_capacity_tons"] for g in grades}
    min_runs = {g: cfg["grades"][g]["min_run_days"] for g in grades}
    holidays = set(cfg["calendar"].get("company_holidays") or []) | set(req.holidays or [])
    mains = []
    for i, d in enumerate(days):
        if i == 0:
            mains.append(d["parts"][0]["grade"])
            continue
        prev = mains[-1]
        incoming = [p["grade"] for p in d["parts"] if p["grade"] != prev]
        mains.append(incoming[0] if incoming else prev)

    # transitions, ceilings, caps, calendar
    for i, d in enumerate(days):
        total = sum(p["tons"] for p in d["parts"])
        if d["chg"]:
            f = mains[i - 1] if i else None
            t = d["parts"][-1]["grade"]
            check("%s transition d%d" % (label, i), (f, t) in transitions, "%s→%s" % (f, t))
            if (f, t) in transitions and total > transitions[(f, t)]:
                check("%s ceiling d%d" % (label, i), False, "%d > %d" % (total, transitions[(f, t)]))
            wd = datetime.strptime(d["iso"], "%Y-%m-%d").weekday()
            check("%s weekday d%d" % (label, i), wd <= 4 and d["iso"] not in holidays, d["iso"])
        else:
            g0 = d["parts"][0]["grade"]
            check("%s cap d%d" % (label, i), total <= caps[g0], "%s %d > %d" % (g0, total, caps[g0]))

    # campaigns and min-run (final campaign waived)
    campaigns = []
    s = 0
    for i in range(1, H + 1):
        if i == H or mains[i] != mains[i - 1]:
            campaigns.append((mains[s], i - s, s, i - 1))
            s = i
    for g, length, a, b in campaigns:
        if b < H - 1:
            check("%s min-run %s" % (label, g), length >= min_runs[g],
                  "%d d < %d" % (length, min_runs[g]))

    # VCR campaign structure
    blocks, s = [], None
    for i, gm in enumerate(mains):
        v = gm in ("VCR412", "VCR617")
        if v and s is None:
            s = i
        if not v and s is not None:
            blocks.append((s, i - 1))
            s = None
    if s is not None:
        blocks.append((s, H - 1))
    for a, b in blocks:
        seq = mains[a:b + 1]
        check("%s vcr len [%d-%d]" % (label, a, b), len(seq) >= cfg["vcr"]["min_total_days"], "%d days" % len(seq))
        check("%s vcr entry [%d-%d]" % (label, a, b), a > 0 and mains[a - 1] == "BR150",
              "enters from %s" % (mains[a - 1] if a else "horizon start"))
        seen617 = False
        for gm in seq:
            if gm == "VCR617":
                seen617 = True
            if gm == "VCR412" and seen617:
                check("%s vcr order [%d-%d]" % (label, a, b), False, "412 after 617")

    # reactor pairing
    for i, d in enumerate(days):
        p1, p2 = d["p1"], d["p2"]
        v = mains[i] in ("VCR412", "VCR617")
        if v and not (p1 == "prod" and p2 == "prod"):
            check("%s vcr reactors d%d" % (label, i), False, "%s/%s" % (p1, p2))
        if not v and (p1 == "prod") == (p2 == "prod"):
            check("%s br pair d%d" % (label, i), False, "%s/%s" % (p1, p2))
        if p1 == "clean" and p2 == "clean":
            check("%s cleaning overlap d%d" % (label, i), False)

    # cleaning windows exactly 7 days, per pair
    clean_days = cfg["reactor"]["cleaning_days"]
    for key, name in (("p1", "RX1-2"), ("p2", "RX3-4")):
        flags = [d[key] == "clean" for d in days]
        i = 0
        while i < H:
            if flags[i]:
                j = i
                while j < H and flags[j]:
                    j += 1
                length = j - i
                truncated = (j == H)  # window continues past the horizon
                check("%s clean window %s" % (label, name),
                      length == clean_days or length % clean_days == 0 or truncated,
                      "%d days" % length)
                i = j
            else:
                i += 1

    # reactor ages, simulated from the initial state
    age12, age34 = req.initial.rx12_age, req.initial.rx34_age
    rx12_max = cfg["reactor"]["rx12_max_age_days"]
    rx34_gate = cfg["reactor"]["rx34_max_age_before_vcr"]
    rx12_gate = cfg["reactor"]["rx12_max_age_at_vcr_end"]
    for i, d in enumerate(days):
        first_vcr = mains[i] in ("VCR412", "VCR617") and (i == 0 or mains[i - 1] not in ("VCR412", "VCR617"))
        last_vcr = mains[i] in ("VCR412", "VCR617") and (i == H - 1 or mains[i + 1] not in ("VCR412", "VCR617"))
        if first_vcr:
            check("%s rx34 gate d%d" % (label, i), age34 <= rx34_gate, "%d > %d" % (age34, rx34_gate))
        age12 = age12 + 1 if d["p1"] == "prod" else (0 if d["p1"] == "clean" else age12)
        age34 = age34 + 1 if d["p2"] == "prod" else (0 if d["p2"] == "clean" else age34)
        check("%s rx12 age d%d" % (label, i), age12 <= rx12_max, "%d > %d" % (age12, rx12_max))
        if last_vcr:
            check("%s rx12 vcr-end gate d%d" % (label, i), age12 < rx12_gate, "%d >= %d" % (age12, rx12_gate))

    # fulfillment consistency
    produced = {g: 0 for g in grades}
    for d in days:
        for p in d["parts"]:
            produced[p["grade"]] += p["tons"]
    for row in res["fulfillment"]:
        check("%s produced %s" % (label, row["grade"]), produced[row["grade"]] == row["produced"],
              "%d vs %d" % (produced[row["grade"]], row["produced"]))


def evaluate_roundtrip(label, res, req):
    """The editable-Gantt evaluator must accept every solver plan unchanged
    (zero conflicts, same grade sequence and reactor statuses)."""
    draft = manual.draft_from_result(res)
    ev = manual.evaluate({**req.model_dump(), **draft})
    check("%s evaluator accepts solver plan" % label, ev["conflicts"] == 0,
          "; ".join(c["text"] for c in ev["checks"] if c["level"] == "conflict"))
    mains_a = [d["parts"][-1]["grade"] for d in res["days"]]
    mains_b = [d["parts"][-1]["grade"] for d in ev["days"]]
    check("%s evaluator keeps grade sequence" % label, mains_a == mains_b)
    pairs_a = [(d["p1"], d["p2"]) for d in res["days"]]
    pairs_b = [(d["p1"], d["p2"]) for d in ev["days"]]
    check("%s evaluator keeps reactor statuses" % label, pairs_a == pairs_b,
          next((("d%d %s vs %s" % (i, a, b)) for i, (a, b) in enumerate(zip(pairs_a, pairs_b)) if a != b), ""))
    return draft


def evaluate_broken(label, draft, req):
    """A deliberately broken edit must be flagged: shorten a campaign below
    its min-run and drop every cleaning window."""
    min_runs = {g: spec["min_run_days"] for g, spec in _load_config()["grades"].items()}
    camps = [dict(c) for c in draft["campaigns"]]
    # Cutting just one day only breaks a campaign that sits exactly at its
    # min-run, so cut it to min-run - 1 (long campaigns gave false FAILs).
    victim = next((i for i, c in enumerate(camps[1:-1], start=1)
                   if 2 <= min_runs[c["grade"]] <= c["days"]), None)
    if victim is None:
        print("  (skip broken-plan check: no interior campaign to shorten)")
        return
    cut = camps[victim]["days"] - (min_runs[camps[victim]["grade"]] - 1)
    camps[victim]["days"] -= cut
    camps[victim + 1]["days"] += cut
    ev = manual.evaluate({**req.model_dump(), "campaigns": camps, "cleanings": [], "pair_plan": draft["pair_plan"]})
    print("  broken plan -> %s (%d conflicts)" % (ev["kpis"]["status"], ev["conflicts"]))
    check("%s evaluator flags broken plan" % label, ev["conflicts"] >= 1)
    flagged_days = {d for c in ev["checks"] if c["level"] == "conflict" for d in c["days"]}
    check("%s evaluator reports conflict days" % label, len(flagged_days) > 0)


def scenario(label, **kwargs):
    print("\n=== %s ===" % label)
    req = OptimizeRequest(**kwargs)
    res = solve(req.model_dump())
    print("  status: %s | mode: %s | solve_s: %s" % (res["status"], res["mode"], res["solve_s"]))
    print("  kpis: %s" % res["kpis"])
    if res["status"] != "feasible":
        check("%s feasible" % label, False, str(res.get("message")))
        return res
    validate(label, res, _load_config(), req)
    draft = evaluate_roundtrip(label, res, req)
    evaluate_broken(label, draft, req)
    return res


# Shared with tests/test_optimization.py (pytest runs the same scenarios)
SCENARIOS = {
    "S1 default 28d": dict(horizon_days=28),
    "S2 heavy VCR-412 demand": dict(horizon_days=28, demand={"VCR412": 4000}),
    "S3 horizon 14d": dict(horizon_days=14),
    "S4 heavy BR150L demand": dict(horizon_days=28, demand={"BR150L": 6000}),
}


if __name__ == "__main__":
    print("Running engine self-test...")

    results = {label: scenario(label, **kwargs) for label, kwargs in SCENARIOS.items()}
    s1 = results["S1 default 28d"]
    s2 = results["S2 heavy VCR-412 demand"]

    if s1.get("days") and s2.get("days"):
        m1 = [d["parts"][-1]["grade"] for d in s1["days"]]
        m2 = [d["parts"][-1]["grade"] for d in s2["days"]]
        check("plan reacts to demand (S1 vs S2 differ)", m1 != m2)

    print("\n%s" % ("ALL CHECKS PASSED" if not FAILURES else "FAILURES: %d" % len(FAILURES)))
    for name, detail in FAILURES:
        print("  - %s (%s)" % (name, detail))
    sys.exit(1 if FAILURES else 0)
