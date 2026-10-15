# Adjustable Optimization Priorities

Scenario studio exposes nine dimensionless preference multipliers (0 to 20).
The solver minimizes the sum of weighted monetary model components: purchases,
production, activation, prototype OT, FG holding, RM holding, shortage loss,
safety-stock shortfall and service-target violation. The default is 1 for all.
Weights do not need to sum to 100%; only their relative values express priorities.
Zero removes an objective term, not a physical constraint. All-zero is rejected.

## Financial Interpretation

- `cost_breakdown` and `expected_total_cost` retain unweighted model rates.
- `expected_operating_cost` excludes the three modeled risk penalties.
- `expected_penalty_cost` separately sums shortage, safety and service penalties.
- `weighted_breakdown` gives expected weighted contributions, not invoices.
- `optimized_weighted_score` is the solver's base-case (deterministic), expected
  (stochastic), or worst-scenario (robust) objective. It is not payable USD.
- Scores under different weight sets are not a comparable business KPI.

The legacy `shortage_penalty_multiplier` remains accepted as an additional
shortage preference multiplier; it no longer alters the base loss rate shown
in accounting. Reset weights also clears that legacy multiplier. Old saved
snapshots without weight fields use defaults and require a re-run for scores.

## Physical and Service Boundaries

Lost sales cannot coexist with positive same-grade closing stock. Binary
stockout indicators enforce this even when shortage weight is zero. Service
shortfall slack is measured per scenario before risk aggregation, so the model
objective and reported weighted scores use the same definition.

Service targets and safety stocks remain soft. High weight does not mean a
hard priority or zero-shortage guarantee. The monthly prototype still allows
OT; a zero OT weight does not disable it. Daily reactor scheduling rules remain
outside this monthly model. Shared daily Gantt is not automatically re-optimized
when priorities change, and billing/raw-price forecasts are not newly connected.

Weights persist in monthly saved snapshots and JSON exports. Inputs changed
after solving leave old applied results visible and cannot be saved as new
results until a successful solve. Scenario-condition presets preserve weights;
priority presets change preferences but require an explicit Apply priorities.

## Before / After and Controlled Experiments

The Before / After reference normally advances to the previous successfully
applied plan, including saved-plan restores and selected sensitivity candidates.
It can be pinned, or replaced by the current plan. Failed/in-flight solves do
not become comparison references. Pending edits are excluded. When conditions,
risk strategy or model metadata also differ, the UI warns against attributing
changes to weights alone. Monthly decisions, grade quantities and unweighted
cost components can be compared in the expandable table.

Sensitivity captures the last applied inputs and performs a fresh reference
solve, followed by sequential one-weight changes. Each API response carries a
signature of the loaded optimizer source and fixed model data. Requests, model
signature, horizons and scenario definitions must match except for the chosen
weight. New inputs cannot leak into an ongoing study. A model mismatch blocks
adoption; an all-zero candidate is skipped, not silently substituted.

Business tradeoffs compare expected operating expense with unserved volume.
Extra dispatch equals the reduction in expected unserved demand under the same
demand context. Expense per additional ton is shown only for a positive expense
increase and positive additional dispatch. Cheaper plans with lost sales are
not labeled savings. Pareto labels describe only the tested subset and these
two metrics, never global optimality. Filters do not add constraints or solves.

Use plan adopts the actual tested result and its inputs, not an interpolated
weight or an undisclosed re-solve. If current inputs differ, confirmation is
required to restore the captured conditions. Saved monthly snapshots retain
the chosen result. The full experiment is session-local, survives navigation
and can be exported to JSON. Cancellation stops remaining client requests;
the current read-only server solve may still finish. Partial runs are labeled.

## Verification

Run `python -m unittest test_optimization -v` from Backend. Tests cover accounting
invariance for a fixed plan, actual decision changes, score/solver consistency
for all three strategies, legacy defaults, partial fields, zero weights and
rejection of negative, non-finite, unknown or all-zero weights.
