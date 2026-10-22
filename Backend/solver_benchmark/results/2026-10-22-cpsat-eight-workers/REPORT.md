# Integrated Pilot Solver Benchmark

Synthetic data only. Live API and default solver are unchanged.

OR-Tools 9.15.6755; 10.0 s solve budget per run; 8 requested thread(s).
Constant element formulation: convex_hull.
CP-SAT uses the native CP model. SCIP/CBC use one shared bounded MILP translation.
Times below are solve time, excluding model build, MILP conversion and independent validation (all available in JSON/CSV).
This measures solver + formulation, not a formulation-independent solver ranking.

| Case | Solver | Valid plans | Optimal | Median solve s | Best score (weighted USD) | Shortage at best score t |
|---|---|---:|---:|---:|---:|---:|
| demo_28 | cp-sat | 2/2 | 0/2 | 10.132 | 25,236,027.28 | 1833 |
| demo_56 | cp-sat | 2/2 | 0/2 | 10.210 | 61,388,361.48 | 4557 |

## Interpretation limits

- Every accepted plan passes exact-integer checks of every original constraint and a separate CP-SAT fixed-assignment solve.
- Zero-shortage is not guaranteed. Infeasible and time-limit-without-plan are different outcomes.
- Delivery-first skips cost refinement if the first stage has no solver-reported optimality proof.
- Score includes weighted modeled penalties; it is not actual cash spending or profit.
- Unweighted business metrics and source/converted model sizes are retained in JSON/CSV.
- CBC seed is not configurable through this wrapper; its repeat runs are not distinct random-seed trials.
- No warm starts, commercial licenses, production data, UI changes, or API changes are involved.
- A small local benchmark is not evidence of universal superiority or a publication-ready study.
