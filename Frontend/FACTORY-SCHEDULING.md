# Daily Factory Scheduling

The Factory schedule view is adapted from branch Neo at commit 1f99a2d.
It is a local integration, not a merge of Neo's forecast or dashboard.
The existing monthly optimizer and shared daily stock simulator are retained.
The new `/?view=integrated` pilot reuses this factory formulation while adding
daily procurement, material/FG balances and due-day dispatch inside the same
solve. See INTEGRATED-PLANNING.md. The Factory schedule view itself remains
factory-only, as described below.

## Scope

- OR-Tools CP-SAT selects a daily grade sequence, outgoing/incoming tons on
  changeover days, reactor-pair usage and seven-day cleaning windows.
- Daily capacities, 11 transition pairs, transition ceilings, grade minimum
  runs, eight-day VCR campaigns, age gates and the Neo calendar policy apply.
- No OT variable exists. Nominal full-rate output is the default; unchecking it
  explicitly permits flexible output under the same capacity ceilings.
- The first day continues the supplied grade, including when its remaining
  minimum run is zero. VCR already underway can carry elapsed days.
- RX3-4 cleans immediately after observed VCR exits. Reactor ages reset only
  after seven cleaning days. Both pairs are capped at 60 operating days;
  confirm the secondary pair's general limit with production.
- BR normally uses RX1-2; RX3-4 substitutes during RX1-2 cleaning.
- Campaigns and cleanings may cross the final date. The exported continuation
  describes obligations, not proof of a feasible infinite-horizon extension.
  Cleaning already underway on day one is not yet an accepted initial state.

## Separate Planning Layers

The monthly plan can supply production targets and its dates, but this is an
explicit input copy followed by a fresh daily solve, not joint optimization.
The targets have no automatic synchronization after changes. No purchases,
FG/RM inventory, BOM availability, due dates, release lag, monetary objective
or uncertain scenarios are enforced by the factory solver. Its fulfillment
metric is the produced share of the aggregate requirement, not on-time service.
The shared stock/delivery Gantt remains a separate simulation; factory solver
outputs are not automatically claimed to be material-feasible in that view.

The objective is fulfilled tons minus 2/60/400 tons-equivalent per changeover.
It is a preference trade-off, not lexicographic priority, profit or USD.
The manual Gantt evaluator uses nominal capacity and reallocates transition
output heuristically; it checks rules but does not re-optimize. Its own initial
evaluation is the comparison baseline, so allocation changes are not presented
as improvements from a user edit.

## Assumptions

Data remain illustrative. Four changeover losses and within-day allocation are
provisional. Neo's ban on all weekend/holiday switches is stricter than the
older VCR-exit-only requirement and needs confirmation. Allocation of outgoing
VCR output on its exit day while RX3-4 starts cleaning needs subdaily production
confirmation. There is no I/S range or guarantee of zero shortage.

Backend routes: POST /api/v1/plant/schedule and /api/v1/plant/evaluate.
Missing solver dependencies return 503, never a successful sample solve.
UI fallback samples are visibly unverified, cannot be edited as solved plans
and cannot be exported as live plans.

## Verification

- Backend: python -m unittest test_plant_scheduling test_optimization -v
- Frontend: TypeScript check and tests/plant-scheduling.smoke.cjs
- Existing objective and shared-scenario tests remain relevant.
