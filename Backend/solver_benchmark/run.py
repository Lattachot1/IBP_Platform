"""Run from Backend: python -m solver_benchmark.run --help."""
import argparse
import copy
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import statistics
import time

import ortools
import optimization
from ortools.linear_solver import pywraplp
from ortools.sat.python import cp_model

from integrated_planning import engine
from integrated_planning.schemas import IntegratedRequest
from plant_scheduling import engine as factory
from .mip_adapter import Expr, MipAdapter, cp_fixed_check, validate_original, value


class Captured(Exception):
    pass


class CaptureJoint(engine.JointModel):
    def solve(self, model, seconds):
        self.model = model
        model.Minimize(self.cost)
        raise Captured()


def build(request):
    r = IntegratedRequest(**copy.deepcopy(request)).model_dump()
    joint = CaptureJoint(r)
    plant = {**r["plant"], "demand": {g: sum(r["firm_demand"][g]) + sum(r["forecast_residual"][g]) for g in r["opening_fg"]}}
    started = time.perf_counter()
    try:
        factory.solve(plant, integration=joint)
    except Captured:
        pass
    else:
        raise RuntimeError("Expected to capture the factory model before its solve")
    cost = Expr(dict(zip(joint.model.Proto().objective.vars, joint.model.Proto().objective.coeffs)),
                round(joint.model.Proto().objective.offset))
    shortage = Expr({v.Index(): 1 for row in joint.short.values() for v in row})
    return joint, cost, shortage, time.perf_counter() - started


def cases():
    result = {}
    controlled = engine.demo(7, "2026-10-26")
    controlled["plant"]["initial"].update(grade="BR150", remain_days=7, rx12_age=0, rx34_age=0)
    controlled.update(opening_fg={g: 0 for g in controlled["opening_fg"]}, opening_raw_tons=0,
                      raw_storage_tons=3000, purchase_lead_days=0, purchase_limit_tons_per_day=2000,
                      raw_pipeline=[], raw_prices=[1000.0] + [2000.0] * 6,
                      holding_costs={"finished_goods": {g: 0 for g in controlled["opening_fg"]}, "raw_material": 0})
    for key in ("firm_demand", "forecast_residual"):
        controlled[key] = {g: [200 if key == "firm_demand" and g == "BR150" else 0] * 7 for g in controlled["opening_fg"]}
    result["controlled_7"] = controlled
    result["delivery_first_7"] = {**copy.deepcopy(controlled), "policy": "delivery_first"}
    result["infeasible_7"] = {**copy.deepcopy(controlled), "purchase_lead_days": 5}
    result["demo_28"] = engine.demo(28, "2026-10-26")
    result["demo_56"] = engine.demo(56, "2026-10-26")
    stress = copy.deepcopy(result["demo_28"])
    stress["purchase_limit_tons_per_day"] = 240
    stress["raw_prices"] = [1600.0 if d < 14 else 1200.0 for d in range(28)]
    result["procurement_stress_28"] = stress
    locked = copy.deepcopy(result["demo_28"])
    locked["day_locks"] = [{"day": d, "grade": "BR150"} for d in range(7)]
    locked["purchase_locks"] = [{"day": 0, "tons": 500}]
    result["human_locks_28"] = locked
    return result


def objective_for_cp(model, expr):
    return expr.offset + sum(c * model.GetIntVarFromProtoIndex(i) for i, c in expr.terms.items())


def solve_one(joint, cost, shortage, backend, seconds, threads, seed, element_formulation="convex_hull"):
    model = joint.model.Clone()
    goals = [("weighted_cost", cost, engine.MONEY)]
    if joint.req["policy"] == "delivery_first":
        goals.insert(0, ("shortage_tons", shortage, 1))
    row = {"solver": backend, "threads_requested": threads, "seed": seed if backend != "cbc" else None,
           "policy": joint.req["policy"], "time_budget_s": seconds, "element_formulation": element_formulation, "stages": []}
    started = time.perf_counter()
    adapter = None if backend == "cp-sat" else MipAdapter(model, backend.upper(), element_formulation)
    row["conversion_s"] = time.perf_counter() - started
    if adapter:
        row["solver_version"] = adapter.solver.SolverVersion()
        if not adapter.solver.SetNumThreads(threads):
            raise RuntimeError("Solver did not accept requested thread count")
        if backend == "scip":
            if not adapter.solver.SetSolverSpecificParametersAsString(f"randomization/randomseedshift = {seed}\nlimits/gap = 0\nlimits/absgap = 0"):
                raise RuntimeError("SCIP settings rejected")
        row["mip_variables"] = adapter.solver.NumVariables()
        row["mip_constraints"] = adapter.solver.NumConstraints()
    else:
        row["solver_version"] = f"OR-Tools CP-SAT {ortools.__version__}"
    incumbent, spent = None, 0.0
    for index, (name, expr, scale) in enumerate(goals):
        allocation = max(0.001, (seconds - spent) / (len(goals) - index))
        stage_started = time.perf_counter()
        if adapter:
            adapter.minimize(expr, scale)
            adapter.solver.SetTimeLimit(max(1, round(allocation * 1000)))
            parameters = pywraplp.MPSolverParameters()
            parameters.SetDoubleParam(pywraplp.MPSolverParameters.RELATIVE_MIP_GAP, 0.0)
            status = adapter.solver.Solve(parameters)
            found = status in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE)
            status_name = {0: "OPTIMAL", 1: "FEASIBLE", 2: "INFEASIBLE", 3: "UNBOUNDED", 4: "ABNORMAL", 6: "NOT_SOLVED"}.get(status, str(status))
            values = adapter.solution() if found else None
            bound = adapter.solver.Objective().BestBound() if found else None
            optimal = status == pywraplp.Solver.OPTIMAL
            verified_mip = adapter.solver.VerifySolution(1e-5, False) if found else None
            if found and not verified_mip:
                raise ValueError("MILP solver's own feasibility verification failed")
        else:
            model.Minimize(objective_for_cp(model, expr))
            solver = cp_model.CpSolver()
            solver.parameters.max_time_in_seconds = allocation
            solver.parameters.num_search_workers = threads
            solver.parameters.random_seed = seed
            solver.parameters.relative_gap_limit = 0.0
            solver.parameters.absolute_gap_limit = 0.0
            status = solver.Solve(model)
            found = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
            status_name = solver.StatusName(status)
            values = [solver.Value(model.GetIntVarFromProtoIndex(i)) for i in range(len(model.Proto().variables))] if found else None
            bound = solver.BestObjectiveBound() / scale if found else None
            optimal = status == cp_model.OPTIMAL
        elapsed = time.perf_counter() - stage_started
        spent += elapsed
        objective = value(expr, values) / scale if found else None
        row["stages"].append({"goal": name, "status": status_name, "solve_s": elapsed,
                              "objective": objective, "best_bound": bound if bound is not None and math.isfinite(bound) else None,
                              "relative_gap": max(0, (objective - bound) / max(1, abs(objective))) if found and math.isfinite(bound) else None})
        if found:
            failures = validate_original(joint.model, values)
            if failures:
                raise ValueError(f"Source-model validation failed: {failures[:5]}")
            if name == "weighted_cost" and row["policy"] == "delivery_first" and incumbent is not None:
                if value(shortage, values) != value(shortage, incumbent):
                    raise ValueError("Delivery-first shortage lock violated")
            incumbent = values
        if not found or not optimal:
            break
        if index < len(goals) - 1:
            minimum = value(expr, values)
            if adapter:
                adapter.between(expr, minimum, minimum, [])
            else:
                model.Add(objective_for_cp(model, expr) == minimum)
    row["solve_s"] = spent
    row["solver_reported_optimal"] = len(row["stages"]) == len(goals) and all(s["status"] == "OPTIMAL" for s in row["stages"])
    row["status"] = row["stages"][-1]["status"]
    if incumbent is not None:
        row["has_valid_plan"] = True
        check_started = time.perf_counter()
        row["fixed_cp_check"] = cp_fixed_check(joint.model, incumbent)
        row["validation_s"] = time.perf_counter() - check_started
        if row["fixed_cp_check"] != "OPTIMAL":
            raise ValueError(f"CP-SAT fixed-assignment validation failed: {row['fixed_cp_check']}")
        row["weighted_cost_usd_score"] = value(cost, incumbent) / engine.MONEY
        row["shortage_tons"] = value(shortage, incumbent)
        demand = sum(sum(x) for key in ("firm_demand", "forecast_residual") for x in joint.req[key].values())
        row["dispatch_tons"] = demand - row["shortage_tons"]
        row["fulfillment_pct"] = 100 * row["dispatch_tons"] / demand if demand else 100
        row["purchases_tons"] = sum(incumbent[v.Index()] for v in joint.buy)
        row["closing_fg_tons"] = sum(incumbent[v[-1].Index()] for v in joint.fg.values())
        r = joint.req
        products = {p.code: p for p in optimization.PRODUCTS}
        mains = [incumbent[v.Index()] for v in joint.hints[:len(joint.dates)]]
        components = {
            "raw_material": sum(incumbent[v.Index()] * r["raw_prices"][d] for d, v in enumerate(joint.buy)),
            "production": sum(incumbent[joint.prod[d][i].Index()] * products[g].production_cost for d in range(len(joint.dates)) for i, g in enumerate(joint.grades)),
            "setup": sum(a != b for a, b in zip(mains, mains[1:])) * optimization.SETUP_COST,
            "shortage": sum(incumbent[v.Index()] * products[g].shortage_cost for g, xs in joint.short.items() for v in xs),
            "finished_goods_holding": sum(incumbent[joint.fg[g][d].Index()] * r["holding_costs"]["finished_goods"][g] for d in joint.checkpoints for g in joint.grades),
            "raw_material_holding": sum(incumbent[joint.raw[d].Index()] / 1000 * r["holding_costs"]["raw_material"] for d in joint.checkpoints),
        }
        row["operating_cost_usd"] = sum(v for k, v in components.items() if k != "shortage")
        row["modeled_shortage_penalty_usd"] = components["shortage"]
        row["cost_breakdown"] = components
        # Preserve complete synthetic assignments for audit and later warm-start experiments.
        row["assignment"] = incumbent
        row["assignment_sha256"] = hashlib.sha256(json.dumps(incumbent).encode()).hexdigest()
    else:
        row["has_valid_plan"] = False
    return row


def report(results, settings):
    lines = ["# Integrated Pilot Solver Benchmark", "", "Synthetic data only. Live API and default solver are unchanged.", "",
             f"OR-Tools {ortools.__version__}; {settings['seconds']} s solve budget per run; {settings['threads']} requested thread(s).",
             f"Constant element formulation: {settings.get('element_formulation', 'disjunctive')}.",
             "CP-SAT uses the native CP model. SCIP/CBC use one shared bounded MILP translation.",
             "Times below are solve time, excluding model build, MILP conversion and independent validation (all available in JSON/CSV).",
             "This measures solver + formulation, not a formulation-independent solver ranking.", "",
             "| Case | Solver | Valid plans | Optimal | Median solve s | Best score (weighted USD) | Shortage at best score t |",
             "|---|---|---:|---:|---:|---:|---:|"]
    for case in sorted({r['case'] for r in results}):
        for backend in settings['solvers']:
            rs = [r for r in results if r['case'] == case and r['solver'] == backend]
            if not rs:
                continue
            valid = [r for r in rs if r.get('has_valid_plan')]
            best = min(valid, key=lambda r: ((r['shortage_tons'], r['weighted_cost_usd_score']) if r['policy'] == 'delivery_first' else (r['weighted_cost_usd_score'],))) if valid else None
            scores = f"{best['weighted_cost_usd_score']:,.2f}" if best else "-"
            short = str(best['shortage_tons']) if best else "-"
            lines.append(f"| {case} | {backend} | {len(valid)}/{len(rs)} | {sum(r.get('solver_reported_optimal', False) for r in rs)}/{len(rs)} | {statistics.median(r['solve_s'] for r in rs):.3f} | {scores} | {short} |")
    lines += ["", "## Interpretation limits", "",
              "- Every accepted plan passes exact-integer checks of every original constraint and a separate CP-SAT fixed-assignment solve.",
              "- Zero-shortage is not guaranteed. Infeasible and time-limit-without-plan are different outcomes.",
              "- Delivery-first skips cost refinement if the first stage has no solver-reported optimality proof.",
              "- Score includes weighted modeled penalties; it is not actual cash spending or profit.",
              "- Unweighted business metrics and source/converted model sizes are retained in JSON/CSV.",
              "- CBC seed is not configurable through this wrapper; its repeat runs are not distinct random-seed trials.",
              "- No warm starts, commercial licenses, production data, UI changes, or API changes are involved.",
              "- A small local benchmark is not evidence of universal superiority or a publication-ready study.", ""]
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', nargs='+', choices=list(cases()), default=list(cases()))
    parser.add_argument('--solvers', nargs='+', choices=['cp-sat', 'scip', 'cbc'], default=['cp-sat', 'scip', 'cbc'])
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--repeats', type=int, default=2)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--element-formulation', choices=['convex_hull', 'disjunctive'], default='convex_hull')
    parser.add_argument('--output', type=Path, default=Path('solver_benchmark/results/local'))
    args = parser.parse_args()
    if args.seconds <= 0 or args.repeats < 1 or args.threads < 1:
        parser.error('Positive seconds, repeats and threads are required')
    args.output.mkdir(parents=True, exist_ok=True)
    settings = {**vars(args), 'output': str(args.output), 'python': platform.python_version(),
                'platform': platform.platform(), 'ortools': ortools.__version__,
                'created_utc': datetime.now(timezone.utc).isoformat()}
    settings['source_sha256'] = {str(p.relative_to(Path(__file__).parent.parent)): hashlib.sha256(p.read_bytes()).hexdigest()
                                 for p in (Path(__file__), Path(__file__).with_name('mip_adapter.py'), Path(engine.__file__), Path(factory.__file__), Path(factory.CONFIG_PATH))}
    records, snapshots = [], {}
    def save():
        (args.output/'results.json').write_text(json.dumps({'settings': settings, 'inputs': snapshots, 'runs': records}, indent=2, allow_nan=False), encoding='utf-8')
        flat = [{k: v for k, v in r.items() if k not in ('stages', 'assignment', 'cost_breakdown')} for r in records]
        fields = list(dict.fromkeys(k for r in flat for k in r))
        with (args.output/'results.csv').open('w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fields)
            writer.writeheader(); writer.writerows(flat)
        (args.output/'REPORT.md').write_text(report(records, settings), encoding='utf-8')
    for name in args.cases:
        joint, cost, shortage, build_s = build(cases()[name])
        snapshots[name] = joint.req
        digest = hashlib.sha256(str(joint.model.Proto()).encode()).hexdigest()
        kinds = {k: sum(getattr(c, 'has_'+k)() for c in joint.model.Proto().constraints) for k in ('linear', 'element', 'lin_max', 'bool_or', 'bool_and', 'exactly_one', 'at_most_one')}
        for repeat in range(args.repeats):
            order = args.solvers[repeat % len(args.solvers):] + args.solvers[:repeat % len(args.solvers)]
            for backend in order:
                print(f"RUN {name} {backend} repeat={repeat} budget={args.seconds}s", flush=True)
                row = solve_one(joint, cost, shortage, backend, args.seconds, args.threads, repeat, args.element_formulation)
                row.update(case=name, repeat=repeat, build_s=build_s, cp_variables=len(joint.model.Proto().variables),
                           cp_constraints=len(joint.model.Proto().constraints), model_sha256=digest, constraint_types=kinds)
                records.append(row)
                save()
                print(f"  {row['status']} valid={row['has_valid_plan']} score={row.get('weighted_cost_usd_score')} shortage={row.get('shortage_tons')} solve={row['solve_s']:.3f}s", flush=True)
    print(str(args.output.resolve()/'REPORT.md'), flush=True)


if __name__ == '__main__':
    main()
