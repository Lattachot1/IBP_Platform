import math
import unittest
from pydantic import ValidationError

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
    def test_model_signature_tracks_fixed_data_not_preferences(self):
        signature = optimization.model_signature()
        self.assertEqual(len(signature), 64)
        changed_weights = optimization.build_demo_comparison(request(objective_weights={"shortage": 5}))
        self.assertEqual(changed_weights["model_signature"], signature)
        original = optimization.SETUP_COST
        try:
            optimization.SETUP_COST = original + 1
            self.assertNotEqual(optimization.model_signature(), signature)
        finally:
            optimization.SETUP_COST = original
        self.assertEqual(optimization.model_signature(), signature)

    def test_default_and_partial_weight_compatibility(self):
        original = request()
        absent = optimization.build_demo_comparison(original)["selected_plan"]
        explicit = optimization.build_demo_comparison(request(objective_weights=dict(optimization.DEFAULT_OBJECTIVE_WEIGHTS)))["selected_plan"]
        self.assertEqual(absent["cost_breakdown"], explicit["cost_breakdown"])
        self.assertNotIn("objective_weights", original, "Do not mutate caller inputs")
        partial = optimization.normalize_objective_weights({"shortage": 5})
        self.assertEqual(partial["shortage"], 5)
        self.assertEqual(partial["raw_material"], 1)

    def test_score_matches_solved_risk_objective(self):
        req = request(objective_weights={"raw_material": 2.5, "finished_goods_holding": 3, "shortage": 0.25, "service_target_violation": 2})
        scenarios = optimization._scenario_data(req)
        for mode in ("deterministic", "stochastic", "robust"):
            solved = optimization._solve(mode, req, scenarios)
            plan = optimization._evaluate(mode, solved, req, scenarios)
            scores = {s["scenario"]: s["weighted_score"] for s in plan["scenario_outcomes"]}
            expected = sum(s["probability"] * s["weighted_score"] for s in plan["scenario_outcomes"])
            aggregated = scores["base"] if mode == "deterministic" else expected if mode == "stochastic" else max(scores.values())
            self.assertAlmostEqual(plan["optimized_weighted_score"], aggregated, delta=2, msg=mode)
            self.assertAlmostEqual(plan["expected_weighted_score"], sum(plan["weighted_breakdown"].values()), delta=1)

    def test_accounting_is_independent_of_preference_weights_for_fixed_plan(self):
        req = request()
        scenarios = optimization._scenario_data(req)
        solved = optimization._solve("stochastic", req, scenarios)
        original = optimization._evaluate("stochastic", solved, req, scenarios)
        changed = optimization._evaluate("stochastic", solved, request(objective_weights={"shortage": 10, "raw_material": 2}), scenarios)
        self.assertEqual(original["cost_breakdown"], changed["cost_breakdown"])
        self.assertEqual(original["expected_operating_cost"], changed["expected_operating_cost"])
        self.assertNotEqual(original["expected_weighted_score"], changed["expected_weighted_score"])
        self.assertAlmostEqual(original["expected_operating_cost"] + original["expected_penalty_cost"], original["expected_total_cost"], delta=1)

    def test_preferences_really_change_solver_decisions(self):
        base = optimization.build_demo_comparison(request())["selected_plan"]
        purchase = optimization.build_demo_comparison(request(objective_weights={"raw_material": 20, "shortage": 0, "service_target_violation": 0, "safety_stock_gap": 0}))["selected_plan"]
        self.assertLess(purchase["total_purchase_tons"], base["total_purchase_tons"])
        self.assertGreater(purchase["expected_shortage_tons"], base["expected_shortage_tons"])
        self.assertEqual(purchase["objective_weights"]["shortage"], 0)

    def test_invalid_weights_rejected_at_model_and_api_boundary(self):
        from main import ObjectiveWeights
        for invalid in ({"shortage": -1}, {"shortage": 21}, {"shortage": float("nan")}, {"shortage": float("inf")}, {"unknown": 1}, {"shortage": True}, dict.fromkeys(optimization.DEFAULT_OBJECTIVE_WEIGHTS, 0)):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    optimization.normalize_objective_weights(invalid)
                with self.assertRaises(ValidationError):
                    ObjectiveWeights(**invalid)

    def test_zero_weight_cannot_invent_lost_sales_with_stock(self):
        req = request(objective_weights={"shortage": 0, "service_target_violation": 0, "finished_goods_holding": 20})
        scenarios = optimization._scenario_data(req)
        solved = optimization._solve("stochastic", req, scenarios)
        evaluated = optimization._evaluate("stochastic", solved, req, scenarios)
        self.assertAlmostEqual(solved["weighted_objective"], evaluated["expected_weighted_score"], delta=2)

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
