# Local Solver Findings - 22 October 2026

## Decision

Keep the existing native CP-SAT solver for the integrated pilot. These runs
do not justify switching the live API to SCIP or CBC. This is a conclusion
about the current formulations and short runtime budget, not a universal
ranking of solvers.

No API/frontend/default-solver changes were made. The experiment uses only
the existing synthetic demo data, not CALTLAPSE or company billing data.

## Fair Single-Thread Screening

The initial batch used identical source-model hashes per case, one requested
thread, a 10-second solve budget and two repeats. Build, conversion and
validation time are reported separately; some solvers overran the time limit.

| Check | Native CP-SAT | SCIP MILP | CBC MILP |
|---|---:|---:|---:|
| Known 7-day weighted optimum, median solve seconds | 0.019 | 0.020 | 0.043 |
| 7-day delivery-first, both stages optimal | 2/2 | 2/2 | 2/2 |
| Intentionally infeasible raw-material case, correctly detected | 2/2 | 2/2 | 2/2 |
| Valid incumbent in standard 28-day demo | 2/2 | 0/2 | 0/2 |
| Valid incumbent in standard 56-day demo | 2/2 | 0/2 | 0/2 |
| Valid incumbent in procurement-stress case | 2/2 | 1/2 | 0/2 |
| Valid incumbent with human locks | 2/2 | 2/2 | 0/2 |

On the two known-optimum 7-day cases, all solvers returned the same weighted
score (7,276,450) and shortage (600 tons). The unavoidable initial shortage
comes from the synthetic opening stock and release lag; it is not a difference
between solvers.

None of the large-case incumbents was proved optimal within the budget.
`NOT_SOLVED` means no incumbent was returned, not proven infeasibility.

## Formulation Check

The second batch replaced disjunctive constant lookup tables with a stronger
one-hot formulation. The source CP models and objectives were unchanged.
For 28 days, MILP rows fell from 11,008 to 7,471 (3,892 variables unchanged).

Across the three repeated 28/56-day/stress cases, CP-SAT returned incumbents
in 6/6 runs; neither MILP backend returned an incumbent in those 6 runs.
The earlier SCIP stress incumbent did not reappear with this formulation.
Thus fewer rows or a stronger relaxation did not establish a runtime win here.

SCIP/CBC were also checked with complete feasible CP assignments fixed in
the translated models: both formulations accepted both the 28- and 56-day
assignments in all 8 checks. This supports the interpretation that the timed
failures are search/formulation limitations, not a demonstrated rejection of
those particular valid factory plans. It is not a full equivalence proof.

## Native CP-SAT Worker Check

An additional batch used the same 10-second budget with 8 workers, matching
the worker count of the current live integrated solver. It is not a fair
equal-resource comparison against the single-thread MILP runs.

| Case | Best score, 1 worker | Best score, 8 workers | Shortage, 1 worker | Shortage, 8 workers |
|---|---:|---:|---:|---:|
| Standard 28-day | 31,491,379.08 | 25,236,027.28 | 2,317 t | 1,833 t |
| Standard 56-day | 68,119,612.04 | 61,388,361.48 | 5,070 t | 4,557 t |

Scores are weighted USD-equivalent objective values **including modeled
penalties**, not cash expenditures or realized company savings. The selected
best-score 8-worker records still had gaps of about 16.9% and 36.1%,
respectively. They are feasible plans, not known-optimal plans. Parallel runs
are not deterministic, and two repeats are too few for robust statistics.

## Verification and Files

- 64 timed runs: 42 initial, 18 tighter-MILP and 4 eight-worker runs.
- All 33 returned incumbents passed full integer source-constraint checks and
  independent CP-SAT fixed-assignment solves.
- 8 additional full-size CP-to-MILP fixed-assignment checks passed.
- 53 focused regression tests passed, including 10 new benchmark tests.
- Each result batch contains `REPORT.md`, `results.json` and `results.csv`.
- JSON includes per-stage bounds/gaps, exact inputs and model hashes. Later
  batches also include complete synthetic assignments and unweighted expenses.

## Next Experiment

Before changing production solvers, measure CP-SAT at 10/30/60 seconds on
several frozen company-approved inputs, with more repeats and a service or
gap stopping criterion. If MILP remains a candidate, design a plant-specific
MILP rather than treating this generic translation as its best possible form.
Large-case delivery-first and historical production replay need separate
experiments; the present delivery-first comparison is only the 7-day control.
