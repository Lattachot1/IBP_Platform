# Integrated Pilot Solver Benchmark

Synthetic data only. Live API and default solver are unchanged.

OR-Tools 9.15.6755; 10.0 s solve budget per run; 1 requested thread(s).
Constant element formulation: convex_hull.
CP-SAT uses the native CP model. SCIP/CBC use one shared bounded MILP translation.
Times below are solve time, excluding model build, MILP conversion and independent validation (all available in JSON/CSV).
This measures solver + formulation, not a formulation-independent solver ranking.

| Case | Solver | Valid plans | Optimal | Median solve s | Best score (weighted USD) | Shortage at best score t |
|---|---|---:|---:|---:|---:|---:|
| demo_28 | cp-sat | 2/2 | 0/2 | 10.082 | 31,491,379.08 | 2317 |
| demo_28 | scip | 0/2 | 0/2 | 9.559 | - | - |
| demo_28 | cbc | 0/2 | 0/2 | 8.131 | - | - |
| demo_56 | cp-sat | 2/2 | 0/2 | 10.120 | 68,119,612.04 | 5070 |
| demo_56 | scip | 0/2 | 0/2 | 9.563 | - | - |
| demo_56 | cbc | 0/2 | 0/2 | 10.566 | - | - |
| procurement_stress_28 | cp-sat | 2/2 | 0/2 | 10.072 | 32,563,702.96 | 2452 |
| procurement_stress_28 | scip | 0/2 | 0/2 | 9.598 | - | - |
| procurement_stress_28 | cbc | 0/2 | 0/2 | 7.869 | - | - |

## Interpretation limits

- Every accepted plan passes exact-integer checks of every original constraint and a separate CP-SAT fixed-assignment solve.
- Zero-shortage is not guaranteed. Infeasible and time-limit-without-plan are different outcomes.
- Delivery-first skips cost refinement if the first stage has no solver-reported optimality proof.
- Score includes weighted modeled penalties; it is not actual cash spending or profit.
- Unweighted business metrics and source/converted model sizes are retained in JSON/CSV.
- CBC seed is not configurable through this wrapper; its repeat runs are not distinct random-seed trials.
- No warm starts, commercial licenses, production data, UI changes, or API changes are involved.
- A small local benchmark is not evidence of universal superiority or a publication-ready study.
