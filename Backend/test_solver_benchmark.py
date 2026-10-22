import itertools
import unittest

from ortools.linear_solver import pywraplp
from ortools.sat.python import cp_model

from solver_benchmark.mip_adapter import MipAdapter, validate_original
from solver_benchmark.run import build, cases, report, solve_one


class AdapterTests(unittest.TestCase):
    def check_assignments(self, model, domains, formulation="convex_hull"):
        for values in itertools.product(*domains):
            expected = not validate_original(model, list(values))
            mip = MipAdapter(model, 'SCIP', formulation)
            for v, x in zip(mip.variables, values):
                mip.solver.Add(v == x)
            mip.solver.SetTimeLimit(1000)
            status = mip.solver.Solve()
            self.assertIn(status, (pywraplp.Solver.OPTIMAL, pywraplp.Solver.INFEASIBLE))
            self.assertEqual(status == pywraplp.Solver.OPTIMAL, expected, values)
            fixed = model.Clone()
            for i, x in enumerate(values):
                fixed.Add(fixed.GetIntVarFromProtoIndex(i) == x)
            cp = cp_model.CpSolver()
            cp.parameters.num_search_workers = 1
            self.assertEqual(cp.Solve(fixed) == cp_model.OPTIMAL, expected, values)

    def test_domain_holes_and_reified_not_equal(self):
        m = cp_model.CpModel()
        x = m.NewIntVarFromDomain(cp_model.Domain.FromValues([0, 2]), 'x')
        y = m.NewIntVar(0, 2, 'y'); a = m.NewBoolVar('a'); b = m.NewBoolVar('b')
        m.Add(x != y).OnlyEnforceIf([a, b.Not()])
        self.check_assignments(m, [range(3), range(3), range(2), range(2)])

    def test_boolean_constraints_and_reification(self):
        m = cp_model.CpModel()
        a, b, c = [m.NewBoolVar(k) for k in 'abc']
        m.AddBoolOr([a.Not(), b]).OnlyEnforceIf(c)
        m.AddBoolAnd([a, c.Not()]).OnlyEnforceIf(b.Not())
        m.AddExactlyOne([a, b, c])
        m.AddAtMostOne([a.Not(), c])
        self.check_assignments(m, [range(2)] * 3)

    def test_affine_element_and_variable_values(self):
        m = cp_model.CpModel()
        i = m.NewIntVar(0, 1, 'i'); x = m.NewIntVar(0, 2, 'x'); y = m.NewIntVar(0, 3, 'y')
        m.AddElement(i + 1, [99, x + 1, 2], y)
        self.check_assignments(m, [range(2), range(3), range(4)])

    def test_constant_element_both_formulations(self):
        m = cp_model.CpModel()
        i = m.NewIntVar(0, 2, 'i'); y = m.NewIntVar(-1, 2, 'y')
        m.AddElement(i, [2, -1, 2], y)
        for formulation in ('convex_hull', 'disjunctive'):
            self.check_assignments(m, [range(3), range(-1, 3)], formulation)

    def test_out_of_range_element_is_infeasible(self):
        m = cp_model.CpModel()
        i = m.NewIntVar(2, 3, 'i'); y = m.NewIntVar(0, 1, 'y')
        m.AddElement(i, [0, 1], y)
        self.check_assignments(m, [range(2, 4), range(2)])

    def test_min_max_exactness(self):
        m = cp_model.CpModel()
        x = m.NewIntVar(-1, 1, 'x'); y = m.NewIntVar(-1, 1, 'y'); z = m.NewIntVar(-1, 1, 'z')
        m.AddMinEquality(z, [x, -y])
        self.check_assignments(m, [range(-1, 2)] * 3)
        m = cp_model.CpModel()
        x = m.NewIntVar(0, 2, 'x'); z = m.NewIntVar(0, 2, 'z')
        m.AddMaxEquality(z, [x, 1])
        self.check_assignments(m, [range(3)] * 2)

    def test_unsupported_constraint_fails_closed(self):
        m = cp_model.CpModel()
        x = m.NewIntVar(0, 2, 'x'); y = m.NewIntVar(0, 2, 'y')
        m.AddAllDifferent([x, y])
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            MipAdapter(m, 'SCIP')

    def test_all_solvers_match_controlled_optimum(self):
        for name in ('controlled_7', 'delivery_first_7'):
            joint, cost, shortage, _ = build(cases()[name])
            results = [solve_one(joint, cost, shortage, s, 5, 1, 0) for s in ('cp-sat', 'scip', 'cbc')]
            for r in results:
                self.assertTrue(r['solver_reported_optimal'], r)
                self.assertEqual(r['shortage_tons'], 600)
                self.assertEqual(r['weighted_cost_usd_score'], results[0]['weighted_cost_usd_score'])
                self.assertEqual(r['fixed_cp_check'], 'OPTIMAL')
                self.assertEqual(r['operating_cost_usd'], 1643000 + 1610 * 145)
                self.assertEqual(r['weighted_cost_usd_score'], sum(r['cost_breakdown'].values()))

    def test_all_solvers_agree_on_infeasibility(self):
        joint, cost, shortage, _ = build(cases()['infeasible_7'])
        for s in ('cp-sat', 'scip', 'cbc'):
            r = solve_one(joint, cost, shortage, s, 3, 1, 0)
            self.assertEqual(r['status'], 'INFEASIBLE')
            self.assertFalse(r['has_valid_plan'])

    def test_partial_report_does_not_require_pending_solvers(self):
        row = {'case': 'test', 'solver': 'cp-sat', 'solve_s': 1, 'has_valid_plan': False}
        text = report([row], {'seconds': 10, 'threads': 1, 'solvers': ['cp-sat', 'scip', 'cbc']})
        self.assertIn('| test | cp-sat |', text)


if __name__ == '__main__':
    unittest.main()
