# Deterministic Integrated Pilot

Open `/?view=integrated`. This is a new joint model, not a merge of the monthly
results and a separately chosen daily schedule. Monthly stochastic/robust
experiments and the shared mock Gantt remain independent and unchanged.

## Single Model

`integrated_planning.engine.JointModel` extends the existing factory CP-SAT
model before solving. It reuses its production variables, changeover logic,
reactor aging/cleaning and calendar constraints. No duplicated factory rules
or postprocessed feasibility claims are introduced. No overtime is available.

For each day it jointly selects grade/production/reactors and purchase order
quantity, with a fixed purchase lead time. Raw stock balances use integer kg
and grade-specific kg/t BOMs. Tank capacity is checked before same-day material
consumption, not only on closing stock. Purchases arriving beyond the horizon
are disallowed. Preexisting raw receipts are separate fixed pipeline inputs.

Production becomes dispatchable after a calendar-day release lag (default 3,
provisional). Initial FG and preexisting releases are separate inputs. Firm
orders and residual forecast sum to daily demand; residual must exclude booked
orders. Within each day, available stock serves firm demand first, then the
residual. Shortage is lost sales, not backorders. Exact min constraints prevent
stock and artificial shortage coexisting for the same grade/day.

Production, order, FG and demand quantities use integer tons; raw stock is kg.
The pilot operates at product-group level, not SKU-within-group allocation.
Horizons are 7-62 days, with existing factory min-run continuation rules.

## Objectives and Accounting

`weighted_cost` minimizes six weighted monetary components: new BD orders,
production, per-changeover setup, FG holding, RM holding and shortage loss.
All rates besides the configurable holding rates remain illustrative. The
changeover charge is not the monthly optimizer's per-grade activation charge.
Safety-stock and service-target penalties are not imported or silently added.

`delivery_first` solves minimum total unserved tons first. Only when that stage
is proven optimal does it fix the minimum and refine weighted cost. If a stage
times out, return its feasible incumbent and proof status, not a lexicographic
optimality claim. If refinement finds no solution, retain the valid first-stage
incumbent. Objective/best-bound stage reporting is explicit.

The integer monetary objective uses 1e-5 USD units. Each weighted coefficient is
rounded to that scale (RM is kg). Reports separately compute unweighted USD;
weighted scores are preferences, not payable money. Operating expense excludes
modeled shortage loss and the sunk acquisition cost of opening stock / already
committed receipts. This is not a full P&L, profit or cash-flow statement.

Holding rates may be zero. They apply to closing FG and RM on calendar month
ends and the final partial-month date, with no prorating. Weight 0 removes
selection pressure but keeps the accounting charge; rate 0 removes both.
There is no separate minimum-FG objective, terminal salvage, hard service or
I/S policy. Unreleased end-horizon production is reported as WIP with release
dates, never credited to early dispatch.

## Human in the Loop

- Grade-only locks constrain a day's main grade, leaving quantities/reactors
  adjustable. Freeze solved day locks main grade, all quantities and pair states.
- Purchase locks fix order-day quantity, including zero. They are not receipt
  locks. The solver still checks lead time, tanks and material consumption.
- Edits are pending until re-solved. Impossible locks return infeasible;
  no automatic softening, invented stock, overtime or sample success occurs.
- The prior successful solve remains visible as a ghost/delta reference. It is
  not an independently feasible alternative for changed inputs. Changed costs,
  dates, demand or policies are flagged, not attributed only to the locks.
- Inputs and unapproved solved results export to JSON. Imported inputs pass
  server validation before replacing the form. State survives view navigation
  within the current session; it is not silently saved to company systems.

## Data and Scope Limits

The 28/56-day demo has synthetic daily firm/residual profiles, initial stocks,
one committed receipt of 700 t on day index 3, and a two-level BD price path.
The receipt is visible and removable via JSON, not a hidden feasibility patch.
Without adequate opening/pipeline material, full-rate production and a positive
lead time can legitimately make the problem infeasible even with shortages.

Copy monthly assumptions is explicit: copy the horizon, aggregate base demand,
base BD prices, holding rates and six relevant priorities. Aggregate demand is
spread evenly with firm orders set to zero, not claimed to be real daily due
dates. Opening stocks/BOM/pipeline remain demo inputs, and locks are cleared.
The Demand Forecast panel now explicitly loads real billing-trained model
outputs into mapped grades. The raw-price forecasting service is still separate.

## Real Demand Forecast Bridge

Load real demand forecast consumes the existing cached champion models without
retraining. Exact mapping currently covers BR150, BR150L, VCR412 and VCR617.
BR150B and BR360B retain their entered firm/residual values and are visibly
marked manual; no proxy series or zero-filled fake forecast is substituted.
Unavailable models return an error and preserve the current inputs.

The forecast is a total monthly demand estimate. For each grade and calendar
month intersecting the planning window:

1. Select the point, lower-band or upper-band monthly estimate.
2. Allocate its share to the window using calendar days or weekdays excluding
   input holidays. Complete months preserve the selected total, rounded to
   integer tons (half-up). Partial months either fail explicitly or use an
   explicitly selected eligible-day ratio.
3. Subtract the entered firm orders for that same grade, month and window.
   Residual = max(window target - firm quantity, 0). Firm quantities above the
   forecast stay intact, with zero residual and a visible warning.
4. Spread only the residual across eligible daily buckets, preserving its
   integer total. Firm due dates do not move, including weekend due dates.

Thus combined firm plus residual equals max(firm, window target), not firm plus
the full original forecast. Repeated loads do not accumulate demand. An explicit
clear-orders option clears mapped firm quantities only; unmapped grades remain.

Daily allocation is not a validated daily forecast or an observed delivery
schedule. Partial-month proration does not subtract earlier actual shipments
or reconstruct a remaining-month nowcast. Working-day holidays come from the
input calendar, not a learned shipping pattern. These assumptions require
company confirmation. Confirm that the latest billing month is complete and
that invoiced net tonnage is an appropriate demand proxy. The bridge does not
silently alter training data or model selection.

Calendar alignment uses each model's trained-through month and actual forecast
period labels. Historical months and dates beyond the cached 12-month horizon
are rejected, not replaced with fitted values. Lower/upper marginal bands are
deterministic stress paths, not joint uncertainty scenarios or guaranteed
best/worst cases. Nominal intervals and measured empirical coverage are distinct.

An exported demand_source records the model, training/capture timestamps,
monthly point/bounds, allocation assumptions, firm consumption, residual,
rounding and original daily mapped arrays. Snapshot IDs identify captured
inputs, not cryptographic authenticity or company approval. Imported metadata
is validated. Cost/stock/lock edits do not invalidate an unchanged snapshot;
mapped demand, dates or a working-day holiday change does. Reconcile by loading
again or explicitly accept the edited demand as a manual override before solving.
The backend enforces this guard independently of the UI. Provenance stays in
the solved JSON; a manual override is not labeled an untouched model output.

Loading a forecast changes inputs only. It retains stocks, raw prices, BOM,
procurement rules, factory state and human locks. It does not silently solve
or approve a plan. Last-solved source labels separate pending snapshots from
the results currently shown. Real forecasts and local screenshots may contain
company-sensitive information; no public deployment is performed by this change.

There is no daily stochastic/robust formulation yet, no uncertainty recourse,
supplier MOQ/contracts, subdaily reactor allocation, SKU allocation, ERP
write-back or automatic conversion into the shared Gantt. The factory's
provisional transitions/calendar policies and unsupported initial cleaning
carryover remain explicit limitations. Exported continuation is an obligation,
not proof that the next horizon is feasible. Confirm these with the company.

## API and Verification

- GET `/api/v1/planning/pilot?horizon_days=28`: illustrative validated inputs.
- POST `/api/v1/planning/validate`: validate/normalize input without solving.
- POST `/api/v1/planning/integrated`: solve the joint deterministic model.
- GET `/api/v1/planning/demand-forecast/status`: available mapped models/cutoffs.
- POST `/api/v1/planning/demand-forecast`: capture/consume a real forecast.
- Backend: `python -m unittest test_forecast_bridge test_integrated_planning test_plant_scheduling test_optimization -v`
- Browser: `node tests/integrated-planning.smoke.cjs` with existing preview/API.
- Bridge browser: `node tests/demand-forecast-bridge.smoke.cjs` (uses live local
  models and compares captured values against the existing forecast endpoint).
- Pure frontend checks: `node tests/forecast-bridge.test.cjs`.
