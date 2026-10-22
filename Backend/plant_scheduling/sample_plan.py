"""The 28-day sample plan (Phase 1 stub data).

A hand-built schedule that satisfies every written TSL constraint, used
to develop and demo the /optimize page before the CP-SAT engine exists.
Constraint sources: Constraint/New_Constraint_TSL.docx and
Constraint/TSL_Production_Constraints.pdf (11-pair transition table,
daily capacities, min run days, reactor lifecycle, holiday rule).

Story of this plan (Oct 5 - Nov 1, 2026):
  - BR150 campaign finishes its min-run, hands over to BR150B.
  - BR150B -> BR360B -> BR150 loop (the only legal BR360B round trip).
  - RX1-2 reach their 60-day age on Oct 11, go into a 7-day cleaning;
    RX3-4 substitute for the BR grades meanwhile.
  - VCR campaign starts the day RX1-2 return (Oct 19): 412 x3 -> 617 x4,
    total 8 days including both changeovers.
  - VCR ends Monday Oct 26 so the VCR->BR150 changeover falls on a
    weekday (holiday rule); RX3-4 then go into their 7-day cleaning.
"""

# Categorical slots 1-6, fixed order (never cycled). Slot numbers map to
# the page's --s1..--s6 color tokens.
GRADES = {
    "BR150":  {"slot": 1, "disp": "BR150"},
    "BR150B": {"slot": 2, "disp": "BR150B"},
    "BR360B": {"slot": 3, "disp": "BR360B"},
    "VCR412": {"slot": 4, "disp": "VCR-412"},
    "VCR617": {"slot": 5, "disp": "VCR-617"},
    "BR150L": {"slot": 6, "disp": "BR150L"},
}
GRADE_ORDER = ["BR150", "BR150B", "BR360B", "VCR412", "VCR617", "BR150L"]

# Demand defaults in tons per 28-day window (demo values, not real orders).
DEMAND_DEFAULT = {
    "BR150": 2600.0,
    "BR150L": 900.0,
    "BR150B": 1300.0,
    "BR360B": 400.0,
    "VCR412": 500.0,
    "VCR617": 1000.0,
}

# One entry per plan day. cap = changeover-day ceiling (None on normal days).
DAYS = [
    {"iso": "2026-10-05", "date": "5 Oct",  "wd": "Mo", "wknd": False, "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX1-2", "note": "Continuing the previous campaign (min-run already satisfied)"},
    {"iso": "2026-10-06", "date": "6 Oct",  "wd": "Tu", "wknd": False, "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX1-2", "note": ""},
    {"iso": "2026-10-07", "date": "7 Oct",  "wd": "We", "wknd": False, "chg": True,  "cap": 234,  "g": ["BR150", "BR150B"], "t": [100, 134],           "rx": "RX1-2", "note": "Grade change per the 11-pair table"},
    {"iso": "2026-10-08", "date": "8 Oct",  "wd": "Th", "wknd": False, "chg": False, "cap": None, "g": ["BR150B"],          "t": [239],                "rx": "RX1-2", "note": ""},
    {"iso": "2026-10-09", "date": "9 Oct",  "wd": "Fr", "wknd": False, "chg": False, "cap": None, "g": ["BR150B"],          "t": [239],                "rx": "RX1-2", "note": ""},
    {"iso": "2026-10-10", "date": "10 Oct", "wd": "Sa", "wknd": True,  "chg": False, "cap": None, "g": ["BR150B"],          "t": [239],                "rx": "RX1-2", "note": "Saturday — production continues"},
    {"iso": "2026-10-11", "date": "11 Oct", "wd": "Su", "wknd": True,  "chg": False, "cap": None, "g": ["BR150B"],          "t": [239],                "rx": "RX1-2", "note": "RX1-2 age reaches exactly 60 days"},
    {"iso": "2026-10-12", "date": "12 Oct", "wd": "Mo", "wknd": False, "chg": False, "cap": None, "g": ["BR150B"],          "t": [239],                "rx": "RX3-4", "note": "RX1-2 enter 7-day cleaning → RX3-4 take over"},
    {"iso": "2026-10-13", "date": "13 Oct", "wd": "Tu", "wknd": False, "chg": True,  "cap": 225,  "g": ["BR150B", "BR360B"], "t": [115, 110],          "rx": "RX3-4", "note": "BR150B→BR360B direct change allowed"},
    {"iso": "2026-10-14", "date": "14 Oct", "wd": "We", "wknd": False, "chg": False, "cap": None, "g": ["BR360B"],          "t": [230],                "rx": "RX3-4", "note": "min-run ≥ 1 day"},
    {"iso": "2026-10-15", "date": "15 Oct", "wd": "Th", "wknd": False, "chg": True,  "cap": 225,  "g": ["BR360B", "BR150"], "t": [115, 110],           "rx": "RX3-4", "note": "loss for this pair still assumed at −5 t"},
    {"iso": "2026-10-16", "date": "16 Oct", "wd": "Fr", "wknd": False, "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX3-4", "note": ""},
    {"iso": "2026-10-17", "date": "17 Oct", "wd": "Sa", "wknd": True,  "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX3-4", "note": ""},
    {"iso": "2026-10-18", "date": "18 Oct", "wd": "Su", "wknd": True,  "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX3-4", "note": "RX1-2 cleaning complete (7 days)"},
    {"iso": "2026-10-19", "date": "19 Oct", "wd": "Mo", "wknd": False, "chg": True,  "cap": 200,  "g": ["BR150", "VCR412"], "t": [120, 80],            "rx": "RX1-4", "note": "RX1-2 back from cleaning (age 0) · VCR starts — RX3-4 age = 7 ≤ 15"},
    {"iso": "2026-10-20", "date": "20 Oct", "wd": "Tu", "wknd": False, "chg": False, "cap": None, "g": ["VCR412"],          "t": [230],                "rx": "RX1-4", "note": ""},
    {"iso": "2026-10-21", "date": "21 Oct", "wd": "We", "wknd": False, "chg": False, "cap": None, "g": ["VCR412"],          "t": [230],                "rx": "RX1-4", "note": ""},
    {"iso": "2026-10-22", "date": "22 Oct", "wd": "Th", "wknd": False, "chg": True,  "cap": 190,  "g": ["VCR412", "VCR617"], "t": [95, 95],            "rx": "RX1-4", "note": "Switch within the VCR group (all 4 reactors running)"},
    {"iso": "2026-10-23", "date": "23 Oct", "wd": "Fr", "wknd": False, "chg": False, "cap": None, "g": ["VCR617"],          "t": [220],                "rx": "RX1-4", "note": ""},
    {"iso": "2026-10-24", "date": "24 Oct", "wd": "Sa", "wknd": True,  "chg": False, "cap": None, "g": ["VCR617"],          "t": [220],                "rx": "RX1-4", "note": ""},
    {"iso": "2026-10-25", "date": "25 Oct", "wd": "Su", "wknd": True,  "chg": False, "cap": None, "g": ["VCR617"],          "t": [220],                "rx": "RX1-4", "note": ""},
    {"iso": "2026-10-26", "date": "26 Oct", "wd": "Mo", "wknd": False, "chg": False, "cap": None, "g": ["VCR617"],          "t": [220],                "rx": "RX1-4", "note": "VCR ends — 412+617 total 8 days · RX1-2 age = 8 < 50"},
    {"iso": "2026-10-27", "date": "27 Oct", "wd": "Tu", "wknd": False, "chg": True,  "cap": 95,   "g": ["VCR617", "BR150"], "t": [30, 65],             "rx": "RX1-2", "note": "Monday switch out of VCR (holiday rule) · RX3-4 sent to 7-day cleaning"},
    {"iso": "2026-10-28", "date": "28 Oct", "wd": "We", "wknd": False, "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX1-2", "note": ""},
    {"iso": "2026-10-29", "date": "29 Oct", "wd": "Th", "wknd": False, "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX1-2", "note": ""},
    {"iso": "2026-10-30", "date": "30 Oct", "wd": "Fr", "wknd": False, "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX1-2", "note": ""},
    {"iso": "2026-10-31", "date": "31 Oct", "wd": "Sa", "wknd": True,  "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX1-2", "note": ""},
    {"iso": "2026-11-01", "date": "1 Nov",  "wd": "Su", "wknd": True,  "chg": False, "cap": None, "g": ["BR150"],           "t": [230],                "rx": "RX1-2", "note": "End of horizon — RX1-2 age = 14 ≤ 60"},
]

# Reactor-pair status per plan day, parallel to DAYS.
#   prod  = the pair is producing the day's grades
#   clean = the pair is inside its 7-day cleaning window
#   idle  = the pair is standing by (RX3-4 before being pulled into service)
PAIR_STATUS = (
    [("prod", "idle")] * 7      # Oct 5-11: RX1-2 keep producing, RX3-4 on standby
    + [("clean", "prod")] * 7   # Oct 12-18: RX1-2 cleaning, RX3-4 substitute
    + [("prod", "prod")] * 8    # Oct 19-26: VCR on all four reactors
    + [("prod", "clean")] * 6   # Oct 27-Nov 1: RX1-2 produce, RX3-4 cleaning
)

# Age/cleaning story per pair, shown under the reactor rows on the page.
PAIR_NOTES = {
    "RX1-2": "Age 54→60 · cleaning 7 days (Oct 12–18) · back in production, age 1→14 at plan end",
    "RX3-4": "Standby at age 0 · substitute production age 1→7 · VCR-start age 7 ≤ 15 · sent to 7-day cleaning after VCR (until Nov 2)",
}

CHECKS = [
    {"level": "ok", "text": "All 6 changeovers are in the Allow_GradeChange table (BR150→BR150B, BR150B→BR360B, BR360B→BR150, BR150→VCR-412, VCR-412→VCR-617, VCR-617→BR150)"},
    {"level": "ok", "text": "Min-run: BR150B 5 days (≥4) · BR360B 1 day (≥1) · VCR-412 2 days (≥2) · VCR-617 4 days (≥2) · BR150 3 days (≥2)"},
    {"level": "ok", "text": "Changeover-day ceilings respected — 234 / 225 / 200 / 190 / 95 tons per the transition table"},
    {"level": "ok", "text": "VCR-412 + VCR-617 total 8 days (≥8) — the 412-only case still awaits client confirmation"},
    {"level": "ok", "text": "No VCR→BR150 change on holidays — VCR ends Monday Oct 26, switches out Tuesday"},
    {"level": "ok", "text": "RX ages: VCR start RX3-4 = 7 ≤ 15 · VCR end RX1-2 = 8 < 50 · plan end 14 ≤ 60"},
    {"level": "ok", "text": "No overlapping cleanings — RX1-2: Oct 12–18 / RX3-4: Oct 27–Nov 2"},
    {"level": "warn", "text": "Loss for BR360B→BR150 is an assumed −5 t (no official figure from production yet)"},
]

ASSUMPTIONS = [
    "Min-run days count the changeover day as a day of the new grade",
    "Reactor age counts production days only (cleaning days excluded) — directly affects the 60/50/15-day rules",
    "On changeover days the split between the two groups is free within the pair's combined ceiling",
    "Losses for BR150B→BR360B, BR360B→BR150, BR360B→BR150B, VCR-412→BR150 use an assumed −5 t",
    "Weekends and company holidays run production as usual; only VCR→BR150 grade changes are forbidden",
]
