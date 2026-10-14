const assert = require("node:assert/strict");
const {
  evaluatePlan,
  makeDraft,
  dateAt,
  dayAt,
  DEFAULT_ASSUMPTIONS,
} = require("../src/lib/manualPlanning.ts");
const assumptions = () => ({
  ...structuredClone(DEFAULT_ASSUMPTIONS),
  initialStock: Object.fromEntries(
    Object.keys(DEFAULT_ASSUMPTIONS.initialStock).map((g) => [g, 0]),
  ),
  initialRaw: 20000,
  rawCapacity: 30000,
});
const fixture = (overrides = {}) => ({
  startDate: "2026-09-01",
  days: 20,
  campaigns: [{ id: "a", grade: "BR150", start: 0, duration: 2 }],
  purchases: [],
  cleanings: [],
  deliveries: [
    { id: "d1", grade: "BR150", start: 3, tons: 200 },
    { id: "d2", grade: "BR150", start: 4, tons: 200 },
  ],
  ...overrides,
});
const calculate = (plan, config = assumptions()) => evaluatePlan(plan, config);

const base = calculate(fixture());
assert.equal(base.service, 100);
assert.equal(base.totalProduced, 460);
assert.equal(base.totalDelivered, 400);
assert.equal(base.totalShortage, 0);
assert.equal(
  base.daily[2].stock.BR150,
  0,
  "Three-day lag must not release stock early",
);
assert.equal(base.daily[3].stock.BR150, 30);
assert.equal(base.endingFG, 60);
assert(
  Math.abs(base.daily.at(-1).raw - (20000 - 460 * 1.02)) < 1e-7,
  "RM balance must conserve material",
);

const shifted = calculate(
  fixture({ campaigns: [{ id: "a", grade: "BR150", start: 2, duration: 2 }] }),
);
assert.equal(shifted.service, 0);
assert.equal(
  shifted.totalShortage,
  400,
  "Later production must miss the original due dates",
);
assert.equal(
  shifted.endingFG,
  460,
  "Lost sales must not be treated as backorders",
);

const starved = calculate(
  fixture({ purchases: [{ id: "p", start: 5, tons: 1000, price: 1500 }] }),
  { ...assumptions(), initialRaw: 0 },
);
assert.equal(
  starved.totalProduced,
  0,
  "Unavailable material must not generate phantom production",
);
assert.equal(starved.totalShortage, 400);
assert.equal(starved.issues.filter((i) => i.code === "raw-shortage").length, 2);
assert.equal(starved.daily[4].raw, 0);

const overlap = calculate(
  fixture({
    campaigns: [
      { id: "a", grade: "BR150", start: 0, duration: 2 },
      { id: "b", grade: "BR150B", start: 1, duration: 4 },
    ],
  }),
);
assert.equal(
  overlap.daily[1].produced,
  0,
  "An ambiguous full-day overlap must not double-credit output",
);
assert(overlap.issues.some((i) => i.code === "overlap"));

const adjacent = calculate(
  fixture({
    campaigns: [
      { id: "a", grade: "BR150", start: 0, duration: 1 },
      { id: "b", grade: "BR150", start: 1, duration: 1 },
    ],
  }),
);
assert(
  !adjacent.issues.some((i) => i.code === "min-run"),
  "Adjacent same-grade blocks form a continuous run",
);
assert.equal(adjacent.costBreakdown.setups, assumptions().setupCost);

const transition = calculate(
  fixture({
    campaigns: [
      { id: "a", grade: "BR150", start: 0, duration: 2 },
      { id: "b", grade: "BR150B", start: 2, duration: 4 },
    ],
  }),
);
assert.equal(transition.daily[2].produced, 234);
assert.equal(transition.transitionLoss, 5);

const vcrShort = calculate(
  fixture({
    campaigns: [
      { id: "a", grade: "VCR412", start: 0, duration: 2 },
      { id: "b", grade: "VCR617", start: 2, duration: 2 },
    ],
  }),
);
assert(vcrShort.issues.some((i) => i.code === "vcr-block"));
assert.equal(vcrShort.daily[2].produced, 190);
assert(vcrShort.issues.some((i) => i.code === "transition-allocation"));

const vcrOkay = calculate(
  fixture({
    campaigns: [
      { id: "a", grade: "VCR412", start: 0, duration: 2 },
      { id: "b", grade: "VCR617", start: 2, duration: 6 },
    ],
    cleanings: [{ id: "c", pair: "RX3+RX4", start: 8, duration: 7 }],
  }),
);
assert(
  !vcrOkay.issues.some(
    (i) => i.code === "vcr-block" || i.code === "post-vcr-cleaning",
  ),
);
assert.equal(
  vcrOkay.daily[15].age34,
  0,
  "Completed seven-day cleaning resets operating age",
);

const cleaning = calculate(
  fixture({
    cleanings: [
      { id: "c1", pair: "RX1+RX2", start: 0, duration: 7 },
      { id: "c2", pair: "RX3+RX4", start: 0, duration: 7 },
    ],
  }),
);
assert.equal(cleaning.totalProduced, 0);
assert(cleaning.issues.some((i) => i.code === "cleaning-overlap"));

const weekend = calculate(
  fixture({
    campaigns: [
      { id: "a", grade: "VCR617", start: 3, duration: 8 },
      { id: "b", grade: "BR150", start: 11, duration: 2 },
    ],
  }),
);
assert(weekend.issues.some((i) => i.code === "holiday-change" && i.day === 11));

const early = calculate(
  fixture({
    days: 40,
    campaigns: [],
    deliveries: [],
    purchases: [{ id: "p", start: 0, tons: 100, price: null }],
  }),
);
const later = calculate(
  fixture({
    days: 40,
    campaigns: [],
    deliveries: [],
    purchases: [{ id: "p", start: 30, tons: 100, price: null }],
  }),
);
assert.equal(early.costBreakdown.purchases, 150375);
assert.equal(
  later.costBreakdown.purchases,
  140150,
  "Receipt-month price must change when a market-priced arrival crosses a month",
);

const tail = calculate(
  fixture({
    campaigns: [{ id: "a", grade: "BR150", start: 18, duration: 2 }],
    deliveries: [],
  }),
);
assert.equal(tail.unfinishedWip, 460);
assert.equal(
  tail.endingFG,
  0,
  "End-of-horizon WIP is not credited as finished inventory",
);
assert.equal(dateAt("2026-09-01", 30), "2026-10-01");
assert.equal(dayAt("2026-09-01", "2026-10-01"), 30);
assert.equal(makeDraft(null).days, 61);
console.log("All state and stock tests passed.");
const oldPrimary = calculate(
  fixture({
    campaigns: [{ id: "v", grade: "VCR617", start: 0, duration: 8 }],
    cleanings: [{ id: "c", pair: "RX3+RX4", start: 8, duration: 7 }],
  }),
  { ...assumptions(), age12: 45 },
);
assert(
  oldPrimary.issues.some((i) => i.code === "post-vcr-age" && i.day === 8),
  "Post-VCR primary age must be checked even on an idle day",
);
console.log(
  "PASS: lag, inventory conservation, due-date impact, no phantom output, overlaps, continuous runs, transition loss, VCR blocks, cleaning, weekend restriction, monthly price changes, horizon WIP.",
);
