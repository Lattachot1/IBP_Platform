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
        # Without OT, the high-demand case cannot reach the soft 95% target.
        scenarios = optimization._scenario_data(request())
        high_demand = sum(sum(v) for v in scenarios["high"]["demands"].values())
        available = sum(p.initial_inventory for p in optimization.PRODUCTS) + sum(optimization.NORMAL_CAPACITY)
        self.assertLess(100 * available / high_demand, 95)
        self.assertLessEqual(plan["worst_service_level_pct"], 100 * available / high_demand + 0.01)
        self.assertGreater(plan["expected_shortage_tons"], 0)
        self.assertGreater(plan["cost_breakdown"]["service_target_violation"], 0)
        for row, capacity in zip(plan["monthly_plan"], optimization.NORMAL_CAPACITY):
            self.assertLessEqual(row["planned_production_tons"], capacity + 0.1)
        self.assertEqual(plan["total_overtime_tons"], 0)

    def test_stress_request_changes_the_plan(self):
        base = optimization.build_demo_comparison(request())["selected_plan"]
        stressed = optimization.build_demo_comparison(
            request(demand_adjustment_pct=20.0, capacity_adjustment_pct=-10.0)
        )["selected_plan"]

        self.assertNotEqual(base["expected_total_cost"], stressed["expected_total_cost"])
        self.assertEqual(stressed["total_overtime_tons"], 0)
        self.assertGreater(stressed["expected_shortage_tons"], base["expected_shortage_tons"])

    def test_no_overtime_even_for_legacy_weight_and_high_demand(self):
        req = request(demand_adjustment_pct=30, capacity_adjustment_pct=-15, objective_weights={"overtime": 20, "shortage": 20})
        scenarios = optimization._scenario_data(req)
        for mode in ("deterministic", "stochastic", "robust"):
            solved = optimization._solve(mode, req, scenarios)
            plan = optimization._evaluate(mode, solved, req, scenarios)
            self.assertFalse(plan["overtime_allowed"])
            self.assertEqual(plan["total_overtime_tons"], 0)
            self.assertEqual(plan["objective_weights"]["overtime"], 0)
            self.assertEqual(plan["cost_breakdown"]["overtime"], 0)
            for t, capacity in enumerate(solved["decisions"]["normal_capacity"]):
                self.assertLessEqual(sum(q[t] for q in solved["decisions"]["production"].values()), capacity + 0.001)

    def test_only_overtime_weight_cannot_enable_objective(self):
        from main import ObjectiveWeights
        weights = dict.fromkeys(optimization.DEFAULT_OBJECTIVE_WEIGHTS, 0)
        weights["overtime"] = 20
        with self.assertRaises(ValueError):
            optimization.normalize_objective_weights(weights)
        with self.assertRaises(ValidationError):
            ObjectiveWeights(**weights)

    def test_holding_rates_defaults_partial_fields_and_no_mutation(self):
        from copy import deepcopy
        from main import HoldingCosts
        defaults = optimization.default_holding_costs()
        partial = {"finished_goods": {"BR150": 0}, "raw_material": 2.5}
        original = deepcopy(partial)
        rates = optimization.normalize_holding_costs(partial)
        self.assertEqual(partial, original)
        self.assertEqual(rates["finished_goods"]["BR150"], 0)
        self.assertEqual(rates["finished_goods"]["BR150L"], defaults["finished_goods"]["BR150L"])
        self.assertEqual(HoldingCosts(**partial).model_dump(), rates)
        self.assertEqual(optimization.default_holding_costs(), defaults)
        self.assertEqual(optimization.normalize_holding_costs(), defaults)

    def test_holding_rates_invalid_model_and_api(self):
        from main import HoldingCosts
        invalid = [{"unknown": 0}, {"finished_goods": {"missing": 0}}, {"finished_goods": None}]
        for value in (-1, 100001, True, float("nan"), float("inf"), "5"):
            invalid.extend(({"raw_material": value}, {"finished_goods": {"BR150": value}}))
        for rates in invalid:
            with self.subTest(rates=rates):
                with self.assertRaises(ValueError):
                    optimization.normalize_holding_costs(rates)
                with self.assertRaises(ValidationError):
                    HoldingCosts(**rates)

    def test_zero_holding_rates_remove_charges_not_stock_balances(self):
        rates = {"finished_goods": dict.fromkeys((p.code for p in optimization.PRODUCTS), 0), "raw_material": 0}
        req = request(holding_costs=rates)
        scenarios = optimization._scenario_data(req)
        for mode in ("deterministic", "stochastic", "robust"):
            solved = optimization._solve(mode, req, scenarios)
            plan = optimization._evaluate(mode, solved, req, scenarios)
            for component in ("finished_goods_holding", "raw_material_holding"):
                self.assertEqual(plan["cost_breakdown"][component], 0)
                self.assertEqual(plan["weighted_breakdown"][component], 0)
            self.assertGreater(sum(p["expected_ending_inventory_tons"] for p in plan["product_plan"]), 0)
            raw = optimization.INITIAL_RAW_INVENTORY
            for t in range(len(optimization.PERIODS)):
                raw += solved["decisions"]["purchase"][t] - sum(p.bom * solved["decisions"]["production"][p.code][t] for p in optimization.PRODUCTS)
                self.assertAlmostEqual(raw, solved["decisions"]["raw_inventory"][t], delta=0.01)
                self.assertGreaterEqual(raw, -0.01)
            score = plan["scenario_outcomes"][1]["weighted_score"] if mode == "deterministic" else plan["expected_weighted_score"] if mode == "stochastic" else plan["worst_weighted_score"]
            self.assertAlmostEqual(plan["optimized_weighted_score"], score, delta=2)

    def test_zero_weight_does_not_remove_accounting_charge(self):
        req = request(strategy="robust", objective_weights={"finished_goods_holding": 0, "raw_material_holding": 0})
        result = optimization.build_demo_comparison(req)
        plan = result["selected_plan"]
        self.assertGreater(plan["cost_breakdown"]["finished_goods_holding"], 0)
        self.assertEqual(plan["weighted_breakdown"]["finished_goods_holding"], 0)
        self.assertEqual(plan["weighted_breakdown"]["raw_material_holding"], 0)

    def test_custom_holding_rates_account_for_same_plan_exactly(self):
        req = request()
        scenarios = optimization._scenario_data(req)
        solved = optimization._solve("stochastic", req, scenarios)
        original = optimization._evaluate("stochastic", solved, req, scenarios)
        doubled = optimization.default_holding_costs()
        doubled["finished_goods"] = {k: 2 * v for k, v in doubled["finished_goods"].items()}
        doubled["raw_material"] *= 2
        changed = optimization._evaluate("stochastic", solved, request(holding_costs=doubled), scenarios)
        for component in ("finished_goods_holding", "raw_material_holding"):
            self.assertAlmostEqual(changed["cost_breakdown"][component], 2 * original["cost_breakdown"][component], delta=0.2)
        for component in ("raw_material", "production", "shortage"):
            self.assertEqual(changed["cost_breakdown"][component], original["cost_breakdown"][component])

    def test_holding_rates_and_ot_policy_on_request_boundary(self):
        from main import OptimizationDemoRequest, SimulateRequest, handle_optimization_demo, handle_simulate
        result = handle_optimization_demo(OptimizationDemoRequest(**request(holding_costs={"raw_material": 0, "finished_goods": {"BR150": 0}}, objective_weights={"overtime": 20})))
        self.assertFalse(result["overtime_allowed"])
        self.assertEqual(result["input"]["holding_costs"]["raw_material"], 0)
        self.assertEqual(result["input"]["holding_costs"]["finished_goods"]["BR150"], 0)
        self.assertEqual(result["selected_plan"]["cost_breakdown"]["raw_material_holding"], 0)
        with self.assertRaises(ValidationError):
            OptimizationDemoRequest(**request(holding_costs={"raw_material": -1}))
        legacy = handle_simulate(SimulateRequest(base_demand=10000, demand_change_pct=20, enable_ot=True)).model_dump()
        self.assertFalse(legacy["enable_ot"])
        self.assertEqual(legacy["capacity_limit"], 10500)
        self.assertEqual(legacy["extra_cost_thb"], 0)


if __name__ == "__main__":
    unittest.main()
