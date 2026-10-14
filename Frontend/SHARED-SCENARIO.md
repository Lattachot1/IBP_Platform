# Shared Daily Scenario and Ghost Plan

The full workspace retains all nine views and the existing backend/API clients.

Executive cockpit, Interactive plan and Logistics globe now share one in-memory
scenario provider. Executive and Logistics default to the shared plan; the
Standalone sandbox mode retains their previous independent experiments.

- Inbound arrival equals the Gantt purchase receipt date. Moving either updates
  the same daily inventory, production and dispatch evaluation.
- Outbound cargo comes only from fulfilled factory dispatch, not unmet demand.
- Ghost campaigns and receipt markers preserve the original mock plan. Dragging
  and resizing show live impact, then commit one undoable shared change.
- Undo/redo works across the three views. Save draft restores the entire shared
  snapshot in this browser. Export includes assumptions, routes and outcomes.
- The original baseline keeps its original assumptions when prices/demand change.

## Boundaries

The daily starting case is explicitly mock, not a conversion of the monthly
optimizer solution or billing forecast. Monthly solver refreshes never overwrite
manual daily changes. No backend endpoints, model artifacts or company records
are modified. Existing forecast and optimization views remain independent.

Default release lag is provisionally three calendar days, with no OT. The mock
contains rule conflicts and unmet demand. Factory rule coverage is incomplete;
neither manual edits nor the tested adjacent-swap candidate guarantee feasibility
or optimality. Fulfilment uses factory dispatch deadlines, not ocean arrivals.
Shortage is lost sales, not backlog. Headline cost excludes shortage penalty and
does not model revenue. Receipts outside the horizon defer costs, not save money.

## Checks

`node tests/connected-domain.cjs` verifies allocation, material/dispatch consistency,
freight accounting, delayed receipts, candidate conservation and validation.

`PLAYWRIGHT_MODULE` may point to a Playwright installation for
`node tests/connected.smoke.cjs`. The browser check covers all nine views,
shared receipt changes, ghost/live dragging, cross-view undo, save/restore,
monthly refresh isolation and desktop/mobile WebGL rendering.
