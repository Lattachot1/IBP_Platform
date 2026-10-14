# Logistics Globe Sandbox

Open `http://localhost:3000/?view=logistics`.

This is a separate mock logistics visualization, not a supply-chain optimizer, live vessel tracker, or factory-feasible plan. It changes neither the monthly optimizer nor the daily manual planning simulator. No existing company records are assigned mock customer locations.

## Current scope

- Three.js Earth with OrbitControls, port and route raycasting, selected endpoint labels, and direction/late-arrival colors.
- Eight illustrative inbound butadiene / outbound rubber shipments, September-October 2026.
- Date slider and optional playback; in-transit dots use linear elapsed-time progress along schematic arcs, not observed vessel positions.
- Shipment-specific departure, receipt/delivery due date, transit duration, quantity and freight edits.
- Additive global transit stress of 0-20 days; projected late volume and quantity-weighted on-time share update immediately.
- Arrival buffer chart, route inspector, shipment ledger, reset confirmation and JSON export with explicit provenance.
- Edits survive navigation between workspace views during the session. Reload resets the mock; export keeps a copy. Navigation away stops playback.
- Reduced-motion users start with globe rotation off. The ledger remains usable if WebGL or the Earth texture cannot load.

## Meaning of the metrics

- `arrival = departure + transitDays + stressDays`, in elapsed calendar days.
- `slack = required arrival - scenario arrival`; negative means late.
- Snapshot status is Scheduled / In transit / Arrived, based on the selected date.
- Projected on-time share uses all shipment quantities in the selected direction, including future and already-arrived mock shipments. It is not an empirical company service KPI.
- Global stress affects all shipments equally, including historical mock departures. This is a retrospective/planned what-if, not a causal forecast or a simulation of a disruption beginning on the slider date.
- Freight is `tons * mock USD/ton`; delay does not automatically create demurrage or shortage cost. Cargo prices, customs, taxes, storage, insurance, production readiness and transport capacities are excluded.
- Inbound lateness indicates a timing risk against a mock need-by date, **not a computed production shortage**. Procurement dates do not feed the existing inventory model yet.
- Great-circle kilometer values and curves connect approximate geographic points, potentially crossing land. They are **not sailing distances or navigable sea routes**. Transit days are independent mock inputs, not inferred from these distances.
- Arrivals beyond October are calculated and flagged, even though the displayed time slider ends October 31.
- Nothing in this mock confirms that butadiene could be transported on a particular route, vessel, or terminal. Hazardous-cargo handling requirements are outside the sandbox.

## Data contract to confirm with the company

Current typed mock records live in `src/lib/logisticsDemo.ts`:

| Entity | Fields needed |
| --- | --- |
| Location | Stable ID, display name, country, latitude/longitude, node type, verified coordinates |
| Shipment | ID, inbound/outbound, origin/destination IDs, partner ID, product/grade, quantity/unit |
| Schedule | Planned and actual departure, planned and actual arrival, required receipt/delivery date, time zone/calendar |
| Transport | Mode, route/port sequence, lead time, delay distribution, vessel/booking status if permitted |
| Cost | Currency, freight basis, handling/demurrage terms, exchange rate source, Incoterms |
| Planning link | Purchase order, sales order, production batch, inventory event IDs; when stock ownership/availability changes |
| Provenance | Mock vs actual vs forecast, source timestamp, data freshness, anonymization permissions |

Before real integration, move route data to a validated API adapter and replace the hard-coded port lookup. The current JSON export has `schema_version: 1`, ports, shipments, evaluated dates, scenario settings and interpretation notes; it is not an import endpoint or ERP integration. Offset days are relative to `2026-09-01`. Export also retains all eight routes regardless of the UI filter and reports full-network metrics explicitly.

Company confirmations: actual origin/destination ports, permitted partner geography, shipping modes and Incoterms, stock-availability dates, contractual delivery definitions, freight rates and lead-time uncertainty. Only after these are agreed should logistics timing constrain production/inventory or contribute to optimization cost.

## Assets and runtime

- `three` 0.186.1; `@types/three` 0.183.1.
- Local Earth bitmap: `public/images/earth-day.jpg`, downloaded from the [Three.js example repository](https://github.com/mrdoob/three.js/blob/dev/examples/textures/planets/earth_atmos_2048.jpg). Three.js repository carries an MIT license. Confirm the texture's underlying provenance and redistribution rights before public deployment; this download alone is not independent rights clearance.
- No external map API, account, API key or runtime tile requests.
- Existing dependency audit warnings remain; no framework-wide security upgrade was attempted during this visualization change. This prototype is not cleared for public production deployment.

## Verification

`node tests/logistics.test.cjs` (Node 24 type stripping): date boundaries, transit states, quantity weighting, stresses, distance symmetry, no invented delay costs, beyond-horizon arrivals.

`node tests/logistics.smoke.cjs` with Playwright available: desktop/mobile screenshots and WebGL pixel checks, loaded bitmap, raycast selection, pointer orbit, direction filters, editing/stress, playback, export and reset. Set `PLAYWRIGHT_MODULE` to the local installed Playwright module path if needed. Screenshots go to the ignored `.ui-qa/` directory.
