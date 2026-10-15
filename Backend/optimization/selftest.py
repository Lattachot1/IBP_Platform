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
    return res


if __name__ == "__main__":
    print("Running engine self-test...")

    s1 = scenario("S1 default 28d", horizon_days=28)
    s2 = scenario("S2 heavy VCR-412 demand", horizon_days=28, demand={"VCR412": 4000})
    s3 = scenario("S3 horizon 14d", horizon_days=14)
    s4 = scenario("S4 heavy BR150L demand", horizon_days=28, demand={"BR150L": 6000})

    if s1.get("days") and s2.get("days"):
        m1 = [d["parts"][-1]["grade"] for d in s1["days"]]
        m2 = [d["parts"][-1]["grade"] for d in s2["days"]]
        check("plan reacts to demand (S1 vs S2 differ)", m1 != m2)

    print("\n%s" % ("ALL CHECKS PASSED" if not FAILURES else "FAILURES: %d" % len(FAILURES)))
    for name, detail in FAILURES:
        print("  - %s (%s)" % (name, detail))
    sys.exit(1 if FAILURES else 0)
