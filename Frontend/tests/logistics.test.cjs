const assert = require("node:assert/strict");
const {
  MOCK_SHIPMENTS,
  PORTS,
  dayISO,
  dateDay,
  shipmentState,
  summarizeShipments,
  greatCircleKm,
} = require("../src/lib/logisticsDemo.ts");
assert.equal(dayISO(0), "2026-09-01");
assert.equal(dayISO(30), "2026-10-01");
assert.equal(dayISO(60), "2026-10-31");
assert.equal(dateDay("2026-10-01"), 30);
const first = MOCK_SHIPMENTS[0];
assert.equal(shipmentState(first, 1, 0).status, "Scheduled");
assert.equal(shipmentState(first, 2, 0).progress, 0);
assert.equal(shipmentState(first, 5, 0).progress, 0.5);
assert.equal(shipmentState(first, 8, 0).status, "Arrived");
assert.equal(shipmentState(first, 8, 5).status, "In transit");
assert.equal(shipmentState(first, 8, 5).lateDays, 3);
const base = summarizeShipments(MOCK_SHIPMENTS, 18, 0);
assert.equal(base.onTimePct, 100);
assert.equal(base.lateTons, 0);
assert.equal(
  base.tons,
  MOCK_SHIPMENTS.reduce((sum, s) => sum + s.tons, 0),
);
const stress = summarizeShipments(MOCK_SHIPMENTS, 18, 10);
assert.equal(stress.onTimePct, 0);
assert.equal(stress.lateTons, base.tons);
assert.equal(
  stress.freight,
  base.freight,
  "Delay alone cannot invent freight/demurrage costs",
);
const single = summarizeShipments(
  [{ ...first, departure: first.departure + 4 }],
  18,
  0,
);
assert.equal(single.lateTons, first.tons);
assert.equal(summarizeShipments([], 0, 0).onTimePct, 0);
assert.equal(greatCircleKm(PORTS[0], PORTS[0]), 0);
assert(
  Math.abs(
    greatCircleKm(PORTS[0], PORTS[1]) - greatCircleKm(PORTS[1], PORTS[0]),
  ) < 1e-8,
);
assert(greatCircleKm(PORTS[0], PORTS[1]) > 1200);
assert.equal(shipmentState({ ...first, departure: 60 }, 60, 20).arrival, 86);
console.log(
  "PASS: calendar, progress, arrival boundaries, transit stress, quantity-weighted on-time share, no invented delay cost, geodesic distances and beyond-horizon arrivals.",
);
