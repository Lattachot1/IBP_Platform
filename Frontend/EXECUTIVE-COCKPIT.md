# Executive Cockpit

The default homepage now opens the executive cockpit. Direct link:
`http://localhost:3000/?view=executive`. The prior dashboard remains at
`/?view=overview`; classic UI remains at `/classic`.

## Presentation intent

An operating story, not a marketing page:

1. Situation: modeled business exposure and a schematic four-reactor factory.
2. Disruption: price, demand and receipt timing pressure tests.
3. Responses: three transparent, deterministic candidate interventions.
4. Decisions: suggested follow-up roles, discussion checkboxes, notes and export.

`Present` opens an in-app presentation layer with chapter navigation and a
keyboard focus trap. Escape exits. It does not require browser fullscreen,
send messages, approve a plan, or dispatch anything. `Board brief` downloads
a self-contained, human-readable HTML discussion brief with print/PDF
support through the browser. A separate download icon exports full scenario
JSON. Neither is a PowerPoint deck or audited financial statement.
Scenario edits, review checkboxes and notes are kept in the open session
when navigating views; reload resets them. Export before closing the session.

## Source and scope

- All executive data is a **standalone mock**, independent of monthly API
  optimization, billing forecasts, manual draft edits and the logistics map.
- Uses the existing daily `evaluatePlan` ledger, a standalone `makeDraft(null)`
  campaign sequence and mock opening inventory/BOM/costs.
- Monthly mock purchases are divided into three receipts per month. Primary
  cleaning starts day 33; secondary cleaning starts day 57. These choices are
  illustrative events, not algorithmically optimized schedules.
- September-October production window plus a **common seven-day evaluation
  tail** through November 7. All candidates use the same 68-day accounting
  horizon. There is no extra tail production or overtime. The tail captures
  extended deliveries and the end-of-horizon cleaning window.
- Lag: three calendar days provisionally. Daily snapshots are end-of-day,
  whereas headline metrics describe the complete evaluation horizon.
- Service is deterministic delivered/required tonnage in this simulation;
  shortages are lost sales, not backlog. Do not interpret it as historical
  company performance or guaranteed future service.

## Pressure tests and responses

Price shocks multiply the illustrative monthly purchase prices. Demand
shocks scale every delivery quantity. Receipt shocks shift every receipt,
including past dates in the mock, by the selected elapsed calendar days.
No probability or causal interpretation is assigned.

| Response | Mechanism | Important assumption |
| --- | --- | --- |
| Keep schedule | Original campaign/delivery dates, delayed material receipts | No intervention |
| Restore receipt dates | Restore all original raw-material arrival dates | Supplier can actually recover; mock premium USD 35/t when delay is positive |
| Delivery extensions | Shift every delivery due date seven days later, preserve all demand | Every customer accepts; mock agreement cost USD 50,000 |

The third option's fulfilment metric uses **revised dates**, not the original
customer commitments. It is labeled separately and no overall winner is
automatically recommended. A larger service percentage after renegotiation
is not evidence of better original-date on-time performance. Unit tests
assert that the original quantity never disappears at the horizon.

## Financial interpretation

Headline cost = raw-material purchase cost + production + setups + modeled
FG/RM holding + mock intervention cost. The shortage penalty is shown
separately, not buried in the headline. The waterfall reconciles the
original base to the selected scenario using these same components.

These are not actual cash flows, profit, an opportunity-loss estimate,
company-validated costs, or realized savings. Opening inventory valuation,
sales revenue, cash timing, taxes, FX, contracts and complete opportunity
cost are absent. Delayed receipts outside the evaluation horizon are
explicitly flagged; their purchase cost is **excluded, not saved**.

## Factory view

Three.js geometry shows four reactor vessels, process pipes, an RM tank,
product pallets and schematic flow. End-of-day ledger values control reactor
colors, tank level, pallet visibility and whether process flow moves.
Selecting a reactor reveals pair, status and modeled operating age.

This is **not** an as-built plant model, a calibrated digital twin, telemetry,
actual equipment dimensions or proof of factory feasibility. No sensor or
ERP connection exists. The diagram alone cannot certify safety or physical
transport/production viability. Implemented rule conflict counts remain
separate from missing/unverified factory constraints. Reduced motion keeps
the flow static; snapshots and camera interaction still work. Non-WebGL
devices retain the state inspector and business controls.

## Next integration prerequisites

Company confirmation: opening FG/RM/WIP and equipment age; daily due dates;
complete grade transition and cleaning logic; procurement lead times and
recovery options; contractual acceptance of extensions; actual financial
formulas and accounting horizon. Only after confirmation should an exported
executive response become input to the real optimizer or execution plan.

Existing dependency security warnings have not been addressed in this
frontend feature. This remains a local prototype, not a production release.

## Verification

- `tests/executive.test.cjs`: quantitative accounting, no demand lost from
  the extended horizon, price-only service invariance, recovery premium,
  raw holds and reactor/cleaning status.
- `tests/executive.smoke.cjs`: desktop/mobile canvas pixel checks and
  screenshots, orbit and top view, moving process flow, event presets,
  metrics and response selection, presentation, review/export, navigation
  preservation, playback and WebGL fallback.
- Existing workspace test now explicitly opens `/?view=overview`, because
  the default homepage intentionally changed. Other routes remain intact.
