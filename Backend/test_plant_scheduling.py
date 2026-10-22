"""Independent regression checks for daily scheduling, not monthly cost optimization."""
import unittest
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from plant_scheduling import engine, manual
from plant_scheduling.schemas import OptimizeRequest, EvaluateRequest


class PlantSchedulingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.request = OptimizeRequest(start_date="2026-10-26", time_limit_s=5).model_dump()
        cls.result = engine.solve(cls.request)
        cls.cfg = engine._load_config()

    def test_real_solver_no_ot_and_no_mutation(self):
        r = self.result
        self.assertEqual(r["mode"], "cspat")
        self.assertEqual(r["status"], "feasible")
        self.assertEqual(len(r["days"]), 28)
        self.assertTrue(r["full_rate"])
        self.assertNotIn("overtime", str(r).lower())
        self.assertEqual(self.request, OptimizeRequest(start_date="2026-10-26", time_limit_s=5).model_dump())

    def test_daily_capacity_transition_calendar_and_full_rate(self):
        transitions = {(x["from"], x["to"]): x["ceiling_tons"] for x in self.cfg["transitions"]}
        prev = self.request["initial"]["grade"]
        for d in self.result["days"]:
            current = d["parts"][-1]["grade"]
            total = sum(p["tons"] for p in d["parts"])
            if d["chg"]:
                self.assertIn((prev, current), transitions)
                self.assertEqual(total, transitions[prev, current])
                self.assertLess(date.fromisoformat(d["iso"]).weekday(), 5)
                self.assertTrue(all(p["tons"] >= 1 for p in d["parts"]))
            else:
                self.assertEqual(total, self.cfg["grades"][current]["daily_capacity_tons"])
            prev = current

    def test_reactor_ages_and_post_vcr_cleaning(self):
        days = self.result["days"]
        ages = [54, 0]
        streak = [0, 0]
        for i, d in enumerate(days):
            for pair, key in enumerate(("p1", "p2")):
                if d[key] == "prod":
                    ages[pair] += 1
                    streak[pair] = 0
                elif d[key] == "clean":
                    streak[pair] += 1
                    if streak[pair] % 7 == 0:
                        ages[pair] = 0
                else:
                    streak[pair] = 0
                self.assertLessEqual(ages[pair], 60)
            self.assertFalse(d["p1"] == d["p2"] == "clean")
            current = d["parts"][-1]["grade"]
            if current.startswith("VCR"):
                self.assertEqual((d["p1"], d["p2"]), ("prod", "prod"))
            if i and days[i - 1]["parts"][-1]["grade"].startswith("VCR") and not current.startswith("VCR"):
                self.assertEqual(d["p2"], "clean")
                self.assertTrue(all(x["p2"] == "clean" for x in days[i:min(i + 7, len(days))]))
        self.assertEqual(ages, [self.result["continuation"]["rx12_age"], self.result["continuation"]["rx34_age"]])

    def test_solver_plan_passes_manual_rules(self):
        draft = manual.draft_from_result(self.result)
        evaluated = manual.evaluate({**self.request, **draft})
        self.assertEqual(evaluated["conflicts"], 0, evaluated["checks"])
        self.assertEqual(evaluated["kpis"]["total_tons"], self.result["kpis"]["total_tons"])

    def test_manual_post_vcr_cleaning_is_mandatory(self):
        req = OptimizeRequest(start_date="2026-10-26", horizon_days=14,
                              initial={"grade": "BR150", "remain_days": 2, "rx12_age": 0, "rx34_age": 0}).model_dump()
        req.update(campaigns=[{"grade": "BR150", "days": 2}, {"grade": "VCR412", "days": 8}, {"grade": "BR150", "days": 4}],
                   cleanings=[], pair_plan=[])
        r = manual.evaluate(req)
        self.assertTrue(any("immediately after VCR" in c["text"] for c in r["checks"]))
        req["cleanings"] = [{"pair": "RX3-4", "start": 10}]
        r = manual.evaluate(req)
        self.assertFalse(any("immediately after VCR" in c["text"] for c in r["checks"]))

    def test_cleaning_resets_after_seven_days_and_cannot_hide_age(self):
        req = OptimizeRequest(start_date="2026-10-26", horizon_days=14,
                              initial={"grade": "BR150", "remain_days": 2, "rx12_age": 60, "rx34_age": 0}).model_dump()
        req.update(campaigns=[{"grade": "BR150", "days": 14}],
                   cleanings=[{"pair": "RX1-2", "start": 0}], pair_plan=[])
        r = manual.evaluate(req)
        self.assertEqual(r["conflicts"], 0, r["checks"])
        self.assertIn("age at plan end: 7 days", r["pair_notes"]["RX1-2"])

    def test_boundary_vcr_continues_without_invented_weekend_exit(self):
        req = OptimizeRequest(start_date="2026-10-26", horizon_days=7, time_limit_s=5,
                              initial={"grade": "VCR412", "remain_days": 2, "rx12_age": 0, "rx34_age": 0, "vcr_elapsed_days": 5}).model_dump()
        r = engine.solve(req)
        self.assertEqual(r["status"], "feasible")
        self.assertTrue(r["days"][-1]["parts"][-1]["grade"].startswith("VCR"))
        self.assertGreaterEqual(r["continuation"]["vcr_elapsed_days"], 12)

    def test_schema_rejects_bad_inputs(self):
        for change in ({"demand": {"BAD": 1}}, {"demand": {"BR150": -1}},
                       {"demand": {"BR150": float("nan")}}, {"demand": {"BR150": float("inf")}},
                       {"initial": {"grade": "BAD"}}, {"initial": {"rx12_age": 61}},
                       {"holidays": ["not-a-date"]}, {"start_date": "2026-02-30"}):
            with self.subTest(change=change), self.assertRaises(ValidationError):
                OptimizeRequest(**change)

    def test_missing_solver_never_returns_sample_success(self):
        with patch.object(engine, "_solve_cspat", side_effect=ImportError("missing")):
            with self.assertRaises(RuntimeError):
                engine.solve(self.request)

    def test_manual_company_holiday_and_vcr_end_age(self):
        req = OptimizeRequest(start_date="2026-10-26", horizon_days=14, holidays=["2026-10-28"],
                              initial={"grade": "BR150", "remain_days": 2, "rx12_age": 0, "rx34_age": 0}).model_dump()
        req.update(campaigns=[{"grade": "BR150", "days": 2}, {"grade": "BR150L", "days": 12}], cleanings=[], pair_plan=[])
        self.assertTrue(any("weekend/holiday" in c["text"] for c in manual.evaluate(req)["checks"]))
        req.update(holidays=[], initial={"grade": "VCR412", "remain_days": 2, "rx12_age": 42, "rx34_age": 0},
                   campaigns=[{"grade": "VCR412", "days": 8}, {"grade": "BR150", "days": 6}],
                   cleanings=[{"pair": "RX3-4", "start": 8}])
        self.assertTrue(any("last VCR day" in c["text"] and "must be < 50" in c["text"] for c in manual.evaluate(req)["checks"]))

    def test_api_endpoints_and_error_codes(self):
        from main import handle_plant_schedule, handle_plant_evaluate
        with patch("main.plant_engine.solve", return_value=self.result):
            r = handle_plant_schedule(OptimizeRequest(**self.request))
            self.assertEqual(r["mode"], "cspat")
        with self.assertRaises(HTTPException) as invalid:
            handle_plant_evaluate(EvaluateRequest(**{**self.request, "campaigns": [{"grade": "BR150", "days": 1}]}))
        self.assertEqual(invalid.exception.status_code, 422)
        with patch("main.plant_engine.solve", side_effect=RuntimeError("unavailable")):
            with self.assertRaises(HTTPException) as unavailable:
                handle_plant_schedule(OptimizeRequest(**self.request))
            self.assertEqual(unavailable.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
