import copy
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from pydantic import ValidationError

import optimization
from integrated_planning import engine
from integrated_planning.schemas import IntegratedRequest
from plant_scheduling import manual


def small_request(**changes):
    r = engine.demo(7, "2026-10-26")
    r["plant"].update(time_limit_s=5, initial={"grade": "BR150", "remain_days": 7, "rx12_age": 0, "rx34_age": 0, "vcr_elapsed_days": 0})
    r.update(opening_fg={g: 0 for g in r["opening_fg"]}, opening_raw_tons=0, raw_storage_tons=3000,
             purchase_lead_days=0, purchase_limit_tons_per_day=2000, raw_pipeline=[],
             firm_demand={g: [200 if g == "BR150" else 0] * 7 for g in r["opening_fg"]},
             forecast_residual={g: [0] * 7 for g in r["opening_fg"]},
             raw_prices=[1000.0] + [2000.0] * 6,
             holding_costs={"finished_goods": {g: 0 for g in r["opening_fg"]}, "raw_material": 0})
    r.update(changes)
    return r


class IntegratedPlanningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.input = small_request()
        cls.result = engine.solve(IntegratedRequest(**cls.input))

    def test_joint_procurement_production_and_release(self):
        r, a = self.result, self.result["integration"]
        self.assertEqual(r["status"], "feasible")
        self.assertFalse(r["overtime_allowed"])
        self.assertEqual(a["shortage_tons"], 600)
        self.assertEqual(a["dispatch_tons"], 800)
        self.assertEqual(a["closing_fg_tons"], 120)
        self.assertEqual(a["closing_wip_tons"], 690)
        self.assertEqual(a["daily"][0]["purchase_tons"], 1643)
        self.assertEqual(sum(x["purchase_tons"] for x in a["daily"][1:]), 0)
        self.assertAlmostEqual(a["closing_raw_tons"], 0.8)
        self.assertTrue(a["optimality_proven"])
        self.assertEqual(r["kpis"]["shortage_tons"], a["shortage_tons"])
        self.assertEqual(r["kpis"]["fulfillment_pct"], a["fulfillment_pct"])

    def test_daily_material_and_finished_goods_conservation(self):
        r, a = self.result, self.result["integration"]
        raw, stocks = 0, {g: 0 for g in self.input["opening_fg"]}
        for day, flow in zip(r["days"], a["daily"]):
            raw += flow["receipt_tons"] - flow["raw_consumed_tons"]
            self.assertAlmostEqual(raw, flow["raw_stock_tons"], places=6)
            self.assertGreaterEqual(raw, -0.001)
            self.assertLessEqual(flow["production_tons"], 230)
            for g in stocks:
                stocks[g] += flow["releases"][g] - flow["dispatch"][g]
                self.assertEqual(stocks[g], flow["fg_stock"][g])
                self.assertFalse(flow["shortage"][g] and flow["fg_stock"][g])
        self.assertEqual(sum(stocks.values()) + a["dispatch_tons"] + a["closing_wip_tons"], sum(x["production_tons"] for x in a["daily"]))

    def test_zero_holding_rates_really_remove_accounting_charge(self):
        a = self.result["integration"]
        self.assertEqual(a["cost_breakdown"]["finished_goods_holding"], 0)
        self.assertEqual(a["cost_breakdown"]["raw_material_holding"], 0)
        self.assertEqual(a["closing_fg_tons"], 120)
        self.assertEqual(a["operating_cost_usd"], 1643000 + 1610 * 145)
        self.assertEqual(a["weighted_score"], sum(a["cost_breakdown"].values()))

    def test_positive_holding_rates_and_zero_preference_weight(self):
        r = small_request(holding_costs=optimization.default_holding_costs())
        r["weights"].update(finished_goods_holding=0.0, raw_material_holding=0.0)
        a = engine.solve(IntegratedRequest(**r))["integration"]
        # Oct 31 and Nov 1 are two closing checkpoints, including a partial month.
        self.assertEqual(a["holding_checkpoints"], ["2026-10-31", "2026-11-01"])
        self.assertEqual(a["cost_breakdown"]["finished_goods_holding"], (90 + 120) * 13)
        self.assertAlmostEqual(a["weighted_score"], sum(v * r["weights"][k] for k, v in a["cost_breakdown"].items()), places=2)

    def test_zero_lag_uses_today_production_not_future_production(self):
        a = engine.solve(IntegratedRequest(**small_request(release_lag_days=0)))["integration"]
        self.assertEqual(a["shortage_tons"], 0)
        self.assertEqual(a["closing_wip_tons"], 0)
        self.assertEqual(a["closing_fg_tons"], 210)

    def test_firm_orders_get_stock_before_residual_within_day(self):
        r = small_request()
        r["opening_fg"]["BR150"] = 100
        r["forecast_residual"]["BR150"][0] = 500
        a = engine.solve(IntegratedRequest(**r))["integration"]
        self.assertEqual(a["daily"][0]["firm_dispatch"]["BR150"], 100)
        self.assertEqual(a["daily"][0]["dispatch"]["BR150"], 100)
        self.assertEqual(a["daily"][0]["shortage"]["BR150"], 600)

    def test_pipeline_releases_are_available_but_not_new_production(self):
        r = small_request(fg_pipeline=[{"day": 0, "grade": "BR150", "tons": 200}])
        a = engine.solve(IntegratedRequest(**r))["integration"]
        self.assertEqual(a["daily"][0]["dispatch"]["BR150"], 200)
        self.assertEqual(a["shortage_tons"], 400)

    def test_lead_time_and_before_consumption_storage_can_make_infeasible(self):
        for changes in ({"purchase_lead_days": 5}, {"raw_storage_tons": 100}):
            result = engine.solve(IntegratedRequest(**small_request(**changes)))
            self.assertEqual(result["status"], "infeasible")
            self.assertEqual(result["days"], [])
            self.assertNotIn("integration", result)

    def test_lexicographic_delivery_proof_then_cost_refinement(self):
        a = engine.solve(IntegratedRequest(**small_request(policy="delivery_first")))["integration"]
        self.assertEqual([x["goal"] for x in a["stages"]], ["shortage_tons", "weighted_cost"])
        self.assertEqual(a["stages"][0]["value"], 600)
        self.assertEqual(a["shortage_tons"], 600)
        self.assertTrue(a["optimality_proven"])

    def test_human_locks_are_hard_not_postprocess(self):
        r = small_request(day_locks=[{"day": 0, "grade": "BR150", "production": {"BR150": 230}, "rx12": "prod", "rx34": "idle"}], purchase_locks=[{"day": 0, "tons": 1000}])
        result = engine.solve(IntegratedRequest(**r))
        self.assertEqual(result["status"], "feasible")
        self.assertEqual(result["integration"]["daily"][0]["purchase_tons"], 1000)
        self.assertEqual(result["days"][0]["parts"], [{"grade": "BR150", "tons": 230}])
        self.assertEqual(result["integration"]["locks_honored"], {"production_days": 1, "purchase_days": 1})
        r["day_locks"][0]["grade"] = "BR150L"
        self.assertEqual(engine.solve(IntegratedRequest(**r))["status"], "infeasible")

    def test_joint_demo_still_passes_shared_factory_rules(self):
        r = engine.demo(28, "2026-10-26")
        r["plant"]["time_limit_s"] = 5
        original = copy.deepcopy(r)
        result = engine.solve(IntegratedRequest(**r))
        self.assertEqual(result["status"], "feasible")
        checked = manual.evaluate({**r["plant"], **manual.draft_from_result(result)})
        self.assertEqual(checked["conflicts"], 0, checked["checks"])
        self.assertEqual(r, original)

    def test_invalid_inputs_never_reach_the_solver(self):
        mutations = [lambda r: r["raw_prices"].pop(), lambda r: r["raw_prices"].__setitem__(0, float("nan")),
                     lambda r: r["firm_demand"]["BR150"].__setitem__(0, -1),
                     lambda r: r["weights"].update(overtime=1.0),
                     lambda r: r.update(day_locks=[{"day": 0, "grade": "BR150"}, {"day": 0, "grade": "BR150L"}]),
                     lambda r: r.update(purchase_locks=[{"day": 6, "tons": 1}], purchase_lead_days=5),
                     lambda r: r.update(raw_pipeline=[{"day": 7, "tons": 10}]),
                     lambda r: r.update(opening_raw_tons=5000, raw_storage_tons=100),
                     lambda r: r["holding_costs"].update(raw_material=-1)]
        for mutate in mutations:
            r = small_request(); mutate(r)
            with self.subTest(input=r), self.assertRaises(ValidationError):
                IntegratedRequest(**r)

    def test_unavailable_solver_does_not_fabricate_a_plan(self):
        with patch("plant_scheduling.engine._solve_cspat", side_effect=ImportError("missing")):
            with self.assertRaises(RuntimeError):
                engine.solve(IntegratedRequest(**small_request()))

    def test_unproven_shortage_stage_does_not_claim_lexicographic_refinement(self):
        from ortools.sat.python import cp_model
        m = cp_model.CpModel(); x = m.NewIntVar(0, 10, "x")
        joint = engine.JointModel(small_request(policy="delivery_first"))
        joint.shortage, joint.cost, joint.hints = x, 2 * x, [x]
        solver = Mock(parameters=SimpleNamespace())
        solver.Solve.return_value = cp_model.FEASIBLE
        solver.ObjectiveValue.return_value = 2
        solver.BestObjectiveBound.return_value = 0
        solver.StatusName.return_value = "FEASIBLE"
        with patch.object(cp_model, "CpSolver", return_value=solver):
            returned, status = joint.solve(m, 5)
        self.assertIs(returned, solver)
        self.assertEqual(status, cp_model.FEASIBLE)
        self.assertEqual(len(joint.stages), 1)
        self.assertFalse(joint.stages[0]["proven_optimal"])

    def test_failed_cost_refinement_retains_feasible_delivery_incumbent(self):
        from ortools.sat.python import cp_model
        m = cp_model.CpModel(); x = m.NewIntVar(0, 10, "x")
        joint = engine.JointModel(small_request(policy="delivery_first"))
        joint.shortage, joint.cost, joint.hints = x, 2 * x, [x]
        first, second = Mock(parameters=SimpleNamespace()), Mock(parameters=SimpleNamespace())
        first.Solve.return_value = cp_model.OPTIMAL
        first.ObjectiveValue.return_value = 0
        first.BestObjectiveBound.return_value = 0
        first.Value.return_value = 0
        first.StatusName.return_value = "OPTIMAL"
        second.Solve.return_value = cp_model.UNKNOWN
        second.StatusName.return_value = "UNKNOWN"
        with patch.object(cp_model, "CpSolver", side_effect=[first, second]):
            returned, status = joint.solve(m, 5)
        self.assertIs(returned, first)
        self.assertEqual(status, cp_model.FEASIBLE)
        self.assertEqual(joint.stages[-1]["status"], "UNKNOWN")
        self.assertFalse(joint.stages[-1]["proven_optimal"])


if __name__ == "__main__":
    unittest.main()
