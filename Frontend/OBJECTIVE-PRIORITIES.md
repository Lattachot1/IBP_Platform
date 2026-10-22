# Adjustable Optimization Priorities

Scenario studio exposes eight dimensionless preference multipliers (0 to 20).
The solver minimizes the sum of weighted monetary model components: purchases,
production, activation, FG holding, RM holding, shortage loss,
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
hard priority or zero-shortage guarantee. The monthly prototype prohibits
OT: there is no overtime decision variable or capacity extension. Legacy
`objective_weights.overtime` is accepted but normalized to 0, and cannot be the
only positive weight. The classic simulator and its offline fallback also use
normal capacity only. Historical audit records are retained, not rewritten.
Daily reactor scheduling rules remain
outside this monthly model. Shared daily Gantt is not automatically re-optimized
when priorities change, and billing/raw-price forecasts are not newly connected.

## Configurable Holding Rates

`holding_costs.finished_goods` maps each of the six grades to its USD/t/month
rate; `holding_costs.raw_material` sets the raw-material rate. Missing entries
retain the illustrative defaults (FG 13-17, raw material 8). These are monthly
closing-stock charges, not a daily average-stock cost model. Rates must be
finite numbers between 0 and 100000; negative and unknown fields are rejected.

The studio provides seven rate inputs, a set-all-to-zero command and a restore
demo-rates command. Rate 0 removes that charge from both unweighted accounting
and the weighted objective. Weight 0 only removes its optimization preference:
the unweighted holding charge remains. Neither action removes physical stock
balances, storage limits or existing service/safety policies. With both rates
zero, the model no longer financially distinguishes otherwise equivalent stock
levels; it does not become a minimum-inventory scheduling model automatically.

Weights and holding rates persist in monthly saved snapshots and JSON exports. Inputs changed
after solving leave old applied results visible and cannot be saved as new
results until a successful solve. Scenario-condition presets preserve weights;
priority presets change preferences but require an explicit Apply priorities.
Holding-rate edits also require Apply priorities. Snapshots without the current
no-OT model signature load their inputs and are re-solved rather than restoring
an obsolete OT plan as current.

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
weight, including identical holding rates. New inputs cannot leak into an ongoing study. A model mismatch blocks
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
Tests also cover the no-OT capacity ceiling under all strategies, zero versus
weighted-out holding charges, custom rate accounting, partial rate defaults,
invalid rates, physical raw-material conservation and HTTP compatibility.
