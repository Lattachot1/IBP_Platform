import copy
import unittest
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException

from integrated_planning import engine
from integrated_planning.forecast_bridge import GRADE_MAP, ForecastBridgeRequest, apply_forecast, availability
from integrated_planning.schemas import IntegratedRequest


def cached_engine():
    return {"trained_at": "2026-10-01T00:00:00+00:00", "grades": {
        product: {"champion": "TestCachedModel", "trained_through": "2026-09", "baseline_12": np.array([1000.0 + i * 100 + index * 20 for i in range(12)]),
                  "q_lo": {1: 100, 2: 150, 3: 200}, "q_hi": {1: 100, 2: 150, 3: 200},
                  "std_q_lo": 100, "std_q_hi": 100, "interval_level_pct": 80, "coverage_empirical": 0.75}
        for index, product in enumerate(GRADE_MAP.values())}}


def monthly_input(horizon=31, start="2026-10-01"):
    r = engine.demo(horizon, start)
    for g in r["firm_demand"]:
        r["firm_demand"][g] = [0] * horizon
    return r


def bridge(r=None, **options):
    return apply_forecast(ForecastBridgeRequest(input=r or monthly_input(), **options), cached_engine())


class ForecastBridgeTests(unittest.TestCase):
    def test_real_service_cached_forecast_consumed_no_refit(self):
        from forecasting import service
        with patch.object(service, "train_all", side_effect=AssertionError("No training on bridge requests")):
            r = bridge()
        source = r["demand_source"]
        self.assertEqual(len(source["grades"]), 4)
        self.assertEqual(source["manual_grades"], ["BR150B", "BR360B"])
        row = next(g for g in source["grades"] if g["grade"] == "BR150")
        self.assertEqual(row["months"][0]["point_tons"], 1000)
        self.assertEqual(sum(r["forecast_residual"]["BR150"]), 1000)
        self.assertEqual(source["status"], "applied")
        self.assertEqual(len(source["snapshot_id"]), 64)

    def test_firm_orders_consumed_once_not_added_to_full_forecast(self):
        r = monthly_input(); r["firm_demand"]["BR150"][0] = 100; r["firm_demand"]["BR150"][-1] = 50
        out = bridge(r)
        self.assertEqual(out["firm_demand"]["BR150"], r["firm_demand"]["BR150"])
        self.assertEqual(sum(out["forecast_residual"]["BR150"]), 850)
        self.assertEqual(sum(out["firm_demand"]["BR150"]) + sum(out["forecast_residual"]["BR150"]), 1000)
        again = bridge(out)
        self.assertEqual(again["forecast_residual"], out["forecast_residual"])
        self.assertEqual(again["demand_source"]["snapshot_id"], out["demand_source"]["snapshot_id"])

    def test_firm_above_forecast_preserved_with_zero_residual(self):
        r = monthly_input(); r["firm_demand"]["BR150"][0] = 1500
        out = bridge(r)
        self.assertEqual(sum(out["forecast_residual"]["BR150"]), 0)
        self.assertEqual(sum(out["firm_demand"]["BR150"]), 1500)
        self.assertTrue(any("exceed" in w for w in out["demand_source"]["warnings"]))

    def test_clear_only_mapped_firm_and_preserve_other_inputs(self):
        r = monthly_input(); r["firm_demand"]["BR150"][0] = 100; r["firm_demand"]["BR150B"][0] = 50
        r["purchase_locks"] = [{"day": 0, "tons": 200}]
        r["day_locks"] = [{"day": 0, "grade": "BR150"}]
        original = copy.deepcopy(r)
        out = bridge(r, firm_orders_mode="clear")
        self.assertEqual(sum(out["firm_demand"]["BR150"]), 0)
        for g in ("BR150B", "BR360B"):
            self.assertEqual(out["firm_demand"][g], r["firm_demand"][g])
            self.assertEqual(out["forecast_residual"][g], r["forecast_residual"][g])
        normalized = IntegratedRequest(**r).model_dump()
        for key in ("opening_fg", "opening_raw_tons", "raw_prices", "holding_costs", "plant", "day_locks", "purchase_locks", "raw_pipeline", "bom_kg_per_ton"):
            self.assertEqual(out[key], normalized[key], key)
        self.assertEqual(r, original, "Bridge must not mutate caller inputs")

    def test_partial_month_proration_each_month_separately(self):
        r = bridge(monthly_input(14, "2026-10-23"))
        row = next(g for g in r["demand_source"]["grades"] if g["grade"] == "BR150")
        self.assertEqual([m["period"] for m in row["months"]], ["2026-10", "2026-11"])
        self.assertEqual([m["target_window_tons"] for m in row["months"]], [290, 183])
        self.assertEqual(sum(r["forecast_residual"]["BR150"]), 473)
        self.assertTrue(all(m["partial_month"] for m in row["months"]))
        self.assertTrue(any("month-to-date" in w for w in r["demand_source"]["warnings"]))
        with self.assertRaisesRegex(ValueError, "partial planning month"):
            bridge(monthly_input(14, "2026-10-23"), partial_month_policy="reject")

    def test_calendar_month_alignment_not_array_position(self):
        out = bridge(monthly_input(30, "2026-11-01"), partial_month_policy="reject")
        row = next(g for g in out["demand_source"]["grades"] if g["grade"] == "BR150")
        self.assertEqual(row["months"][0]["horizon_step"], 2)
        self.assertEqual(row["months"][0]["point_tons"], 1100)
        self.assertEqual(sum(out["forecast_residual"]["BR150"]), 1100)

    def test_working_days_exclude_weekends_holidays_not_firm_orders(self):
        from datetime import date, timedelta
        r = monthly_input(); r["plant"]["holidays"] = ["2026-10-12"]
        r["firm_demand"]["BR150"][2] = 48  # Saturday, firm date stays unchanged.
        out = bridge(r, allocation="working_days")
        for i in range(31):
            d = date(2026, 10, 1) + timedelta(days=i)
            if d.weekday() >= 5 or d.isoformat() == "2026-10-12":
                self.assertEqual(out["forecast_residual"]["BR150"][i], 0)
        self.assertEqual(out["firm_demand"]["BR150"][2], 48)
        self.assertEqual(sum(out["forecast_residual"]["BR150"]), 952)

    def test_month_without_eligible_working_days_rejected(self):
        r = monthly_input(); r["plant"]["holidays"] = ["2026-10-%02d" % d for d in range(1, 32)]
        with self.assertRaisesRegex(ValueError, "no eligible allocation days"):
            bridge(r, allocation="working_days")

    def test_historical_and_unavailable_future_windows_not_faked(self):
        for start in ("2026-09-01", "2027-10-01"):
            with self.subTest(start=start), self.assertRaisesRegex(ValueError, "Historical fitted values are not substituted"):
                bridge(monthly_input(31, start))

    def test_lower_upper_are_named_deterministic_paths(self):
        lower, point, upper = (bridge(path=p) for p in ("lower", "point", "upper"))
        self.assertEqual([sum(r["forecast_residual"]["BR150"]) for r in (lower, point, upper)], [900, 1000, 1100])
        self.assertTrue(any("not a joint" in w for w in upper["demand_source"]["warnings"]))

    def test_integer_rounding_preserves_selected_window_total(self):
        e = cached_engine(); e["grades"]["UBEPOL BR150"]["baseline_12"][0] = 1000.5
        out = apply_forecast(ForecastBridgeRequest(input=monthly_input()), e)
        self.assertEqual(sum(out["forecast_residual"]["BR150"]), 1001)
        self.assertTrue(all(isinstance(v, int) for v in out["forecast_residual"]["BR150"]))
        row = next(g for g in out["demand_source"]["grades"] if g["grade"] == "BR150")
        self.assertEqual(row["months"][0]["rounding_adjustment_tons"], 0.5)

    def test_modified_demand_requires_reconciliation_or_manual_ack(self):
        out = bridge(); out["firm_demand"]["BR150"][0] += 1
        request = IntegratedRequest(**out)
        self.assertEqual(request.demand_source.status, "modified")
        with self.assertRaisesRegex(ValueError, "Reload the forecast"):
            engine.solve(request)
        out["demand_source"]["manual_override_acknowledged"] = True
        with patch("integrated_planning.engine.factory.solve", return_value={"days": [{}], "status": "feasible"}) as solve:
            engine.solve(IntegratedRequest(**out))
        self.assertEqual(solve.call_args.kwargs["integration"].req["demand_source"]["status"], "modified")
        reconciled = bridge(out)
        self.assertEqual(sum(reconciled["firm_demand"]["BR150"]) + sum(reconciled["forecast_residual"]["BR150"]), 1000)
        self.assertEqual(reconciled["demand_source"]["status"], "applied")
        self.assertFalse(reconciled["demand_source"]["manual_override_acknowledged"])

    def test_cost_and_lock_edits_do_not_invalidate_demand(self):
        out = bridge(); out["raw_prices"][0] = 1234.0
        out["holding_costs"]["raw_material"] = 0
        out["day_locks"] = [{"day": 0, "grade": "BR150"}]
        out["forecast_residual"]["BR150B"][0] += 1
        self.assertEqual(IntegratedRequest(**out).demand_source.status, "applied")
        out["plant"]["start_date"] = "2026-10-02"
        self.assertEqual(IntegratedRequest(**out).demand_source.status, "modified")

    def test_unavailable_or_unmapped_engine_does_not_fall_back_to_demo(self):
        from main import handle_planning_forecast
        request = ForecastBridgeRequest(input=monthly_input())
        with patch("main.forecast_engine", None), self.assertRaises(HTTPException) as unavailable:
            handle_planning_forecast(request)
        self.assertEqual(unavailable.exception.status_code, 503)
        with self.assertRaises(RuntimeError):
            apply_forecast(request, {"trained_at": "now", "grades": {}})

    def test_invalid_forecast_values_and_nan_coverage(self):
        e = cached_engine(); e["grades"]["UBEPOL BR150"]["baseline_12"][0] = float("nan")
        with self.assertRaisesRegex(ValueError, "Invalid point"):
            apply_forecast(ForecastBridgeRequest(input=monthly_input()), e)
        e = cached_engine(); e["grades"]["UBEPOL BR150"]["coverage_empirical"] = float("nan")
        out = apply_forecast(ForecastBridgeRequest(input=monthly_input()), e)
        self.assertIsNone(out["demand_source"]["grades"][0]["coverage_empirical"])

    def test_availability_reports_real_mapping_and_cutoff(self):
        a = availability(cached_engine())
        self.assertEqual(a["earliest_common_month"], "2026-10")
        self.assertEqual(a["manual_grades"], ["BR150B", "BR360B"])
        self.assertEqual(len(a["models"]), 4)

    def test_forecast_snapshot_reaches_actual_joint_solver_and_export(self):
        r = monthly_input(7)
        r["plant"].update(time_limit_s=5, initial={"grade": "BR150", "remain_days": 7, "rx12_age": 0, "rx34_age": 0, "vcr_elapsed_days": 0})
        r["opening_raw_tons"] = 2000
        out = bridge(r)
        result = engine.solve(IntegratedRequest(**out))
        self.assertEqual(result["status"], "feasible")
        self.assertEqual(result["integration"]["demand_tons"], sum(sum(v) for x in (out["firm_demand"], out["forecast_residual"]) for v in x.values()))
        self.assertEqual(result["integration"]["demand_source_status"], "applied")
        self.assertEqual(result["input"]["demand_source"]["snapshot_id"], out["demand_source"]["snapshot_id"])


if __name__ == "__main__":
    unittest.main()
