import math
import unittest

import optimization


def request(**overrides):
    values = {
        "strategy": "stochastic",
        "demand_adjustment_pct": 0.0,
        "capacity_adjustment_pct": 0.0,
        "raw_price_adjustment_pct": 0.0,
        "shortage_penalty_multiplier": 1.0,
        "service_target_pct": 95.0,
    }
    values.update(overrides)
    return values


class OptimizationPrototypeTests(unittest.TestCase):
    def test_returns_all_three_strategies(self):
        result = optimization.build_demo_comparison(request())

        self.assertEqual(result["prototype_status"], "illustrative_assumptions")
        self.assertEqual(result["selected_strategy"], "stochastic")
        self.assertEqual(
            {row["mode"] for row in result["strategy_comparison"]},
            {"deterministic", "stochastic", "robust"},
        )
        self.assertEqual(len(result["selected_plan"]["monthly_plan"]), 2)
        self.assertEqual(len(result["selected_plan"]["product_plan"]), 6)

    def test_plan_metrics_are_finite_and_feasible(self):
        result = optimization.build_demo_comparison(request(strategy="robust"))
        plan = result["selected_plan"]

        self.assertIn(plan["status"], {"Optimal", "Feasible"})
        for field in (
            "expected_total_cost",
            "worst_case_cost",
            "expected_service_level_pct",
            "worst_service_level_pct",
            "total_overtime_tons",
        ):
            self.assertTrue(math.isfinite(plan[field]), field)
        self.assertGreaterEqual(plan["worst_service_level_pct"], 94.9)

    def test_stress_request_changes_the_plan(self):
        base = optimization.build_demo_comparison(request())["selected_plan"]
        stressed = optimization.build_demo_comparison(
            request(demand_adjustment_pct=20.0, capacity_adjustment_pct=-10.0)
        )["selected_plan"]

        self.assertNotEqual(base["expected_total_cost"], stressed["expected_total_cost"])
        self.assertGreaterEqual(stressed["total_overtime_tons"], base["total_overtime_tons"])


if __name__ == "__main__":
    unittest.main()
