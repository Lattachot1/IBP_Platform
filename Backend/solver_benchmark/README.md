# Offline Integrated Pilot Solver Benchmark

This experiment does not change the API, frontend, or default solver. It uses
synthetic requests only, not the CALTLAPSE files or company billing records.

## Run

From `Backend`, with the repository virtual environment:

```powershell
../.venv/Scripts/python.exe -B -m unittest test_solver_benchmark -v
../.venv/Scripts/python.exe -B -u -m solver_benchmark.run --seconds 10 --repeats 2 --threads 1 --output solver_benchmark/results/local
```

Available solvers are `cp-sat`, `scip`, and `cbc`. They are accessed through
the already-installed OR-Tools package. No additional solver installation or
commercial license is needed for these local experiments.

## What stays the same

- The existing factory builder and `JointModel.attach()` generate the model.
- Daily grades, transition losses, minimum runs, calendar, reactor cleaning,
  material balance, tank capacity, receipt timing, FG release lag, dispatch,
  shortage, holding checkpoints, human locks and integer quantities stay intact.
- Objective coefficients, demand, opening stock, prices, weights and policies
  are identical across solvers for each case. JSON records the validated inputs
  and source-model hash.
- No warm starts are passed. Each run has the same total solve-time allowance
  and requested thread count. Solver order is rotated between repeats.
- Delivery-first uses the existing two-stage policy, including skipping the
  cost stage if shortage optimality has not been proved by the solver.

The factory builder currently combines build/solve/report. The benchmark
captures its completed model at the integration solve hook, without modifying
the production builder. This also prevents the benchmark from accidentally
testing a separately maintained factory specification.

## Different formulations

CP-SAT solves the native CP model. SCIP and CBC solve the **same MILP
translation**, generated once per solver/run from the captured CP model.
The adapter supports only the constraint types actually needed here:
bounded integer linear domains, enforced constraints, Boolean OR/AND,
exactly/at-most-one, affine element, and linear max/min.

Reification/disjunctions use expression-specific bounds derived from variable
domains. Constant lookup tables use a one-hot convex-hull formulation by
default; `--element-formulation disjunctive` reproduces the initial big-M
lookup-table formulation. Both formulations are covered by assignment tests.
Unsupported constraints fail closed. The adapter is an experimental
local implementation, not a general-purpose CP-to-MILP compiler.

Consequently, native CP-SAT versus SCIP/CBC measures **solver plus formulation**.
SCIP versus CBC uses an identical MILP formulation and is a narrower comparison.
Weak MILP relaxations may be a formulation problem rather than evidence that
either MILP solver is unsuitable for a carefully redesigned plant model.

## Validation

The adapter tests enumerate assignments to small models, comparing MILP
feasibility, integer source-constraint evaluation, and CP-SAT feasibility.
Integration tests require agreement on the known 7-day optimum and on an
infeasible material-supply case.

For every benchmark incumbent:

1. Round only after checking integer tolerances.
2. Evaluate **every original variable domain and constraint** with integer
   arithmetic. A failed assignment is an error, not a valid plan.
3. For MILP, also call the solver's own `VerifySolution`.
4. Fix the original CP-SAT model to that complete assignment and solve it
   again with no objective. This independent check must return `OPTIMAL`.
5. In delivery-first cost refinement, verify the shortage lock explicitly.

Checking incumbents does not alone prove full feasible-region equivalence.
The assignment-enumeration tests cover the supported translation primitives;
large-model equivalence is still a residual risk of this experimental adapter.

## Outputs and limitations

- `results.json`: full inputs, model/source hashes, solver versions, stages,
  best bounds, gaps, build/translation/validation times and business metrics.
  New runs also retain the complete synthetic assignment and unweighted cost
  breakdown; the initial disjunctive baseline retains assignment hashes only.
- `results.csv`: per-run flattened metrics.
- `REPORT.md`: aggregated local results and interpretation caveats.

Model construction, MILP translation and independent validation are excluded
from the solve budget and reported separately. Actual solve time can exceed
the requested limit while a solver finishes its current work. Use total wall
time as well as solve time when evaluating deployment latency.

Optimality labels are solver-reported under the respective numerical
tolerances, not independent mathematical certificates. An incumbent without
a proof is feasible, not known optimal. No incumbent before the time limit
does not mean infeasible. CBC's seed cannot be configured via this wrapper, so
its repeated runs are timing repeats rather than distinct seeded trials.

The weighted objective includes modeled shortage penalties. It is not actual
cash expense, profit, or evidence of savings at the company. Several small
synthetic cases and two repeats are a screening experiment, not a reliable
universal solver ranking or a publication-ready computational study.

## Local Experiment Batches

See `SUMMARY.md` for the cross-batch findings and limitations.

- `results/2026-10-22-single-thread`: seven synthetic cases, three solvers,
  two repeats, 10-second budget, one thread, initial disjunctive lookups.
- `results/2026-10-22-tight-element`: 28/56-day and procurement-stress cases,
  same solvers/budget/thread count/repeats, stronger constant lookup formulation.
- `results/2026-10-22-cpsat-eight-workers`: two repeats of standard 28/56-day
  native CP-SAT, with eight workers and the same 10-second solve budget.
- `results/2026-10-22-translation-checks.json`: full-size CP incumbents fixed
  in both MILP formulations and checked with both MILP solvers (8 checks).

Each batch has its own report and raw records. Do not pool the two formulations
without labeling them, or treat a case not included in a batch as a failed run.

To reproduce the last validation after a batch with stored assignments:

```powershell
../.venv/Scripts/python.exe -B -m solver_benchmark.verify_translation solver_benchmark/results/2026-10-22-cpsat-eight-workers/results.json --output solver_benchmark/results/2026-10-22-translation-checks.json
```

## Primary References

- [OR-Tools MPSolver implementation and supported backends](https://github.com/google/or-tools/blob/stable/ortools/linear_solver/README.md)
- [OR-Tools Python linear-solver API](https://or-tools.github.io/docs/pdoc/ortools/linear_solver/pywraplp.html)
- [OR-Tools CP model protocol and constraint semantics](https://github.com/google/or-tools/blob/stable/ortools/sat/cp_model.proto)
