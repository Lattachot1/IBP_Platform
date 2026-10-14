const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    file,
  );
const {
  buildExecutiveExperiment,
  executiveBase,
  reactorSnapshot,
  cashComponents,
} = require("../src/lib/executiveDemo.ts");
const { executiveBriefHtml } = require("../src/lib/executiveBrief.ts");
const zero = { demandPct: 0, pricePct: 0, receiptDelay: 0 };
const base = executiveBase();
const normal = buildExecutiveExperiment(zero);
assert.equal(
  base.plan.days,
  68,
  "Common seven-day tail must capture every extended due date",
);
assert.equal(base.plan.purchases.length, 6);
assert.equal(normal.options[0].costExcludingPenalty, normal.cashLikeBase);
assert.equal(
  normal.options[0].evaluation.service,
  normal.options[1].evaluation.service,
);
assert.equal(
  normal.options[1].interventionCost,
  0,
  "No expediting premium when there is no delay",
);
const price = buildExecutiveExperiment({ ...zero, pricePct: 25 });
assert(
  Math.abs(
    price.options[0].evaluation.costBreakdown.purchases -
      base.evaluation.costBreakdown.purchases * 1.25,
  ) < 1e-7,
);
assert.equal(price.options[0].evaluation.service, base.evaluation.service);
const late = buildExecutiveExperiment({ ...zero, receiptDelay: 7 });
assert.equal(late.options[1].interventionCost, 12000 * 35);
assert.equal(late.options[1].evaluation.service, base.evaluation.service);
assert(
  late.options[0].evaluation.totalProduced < base.evaluation.totalProduced,
);
const surge = buildExecutiveExperiment({ ...zero, demandPct: 20 });
assert(
  Math.abs(
    surge.options[0].evaluation.totalDemand - base.evaluation.totalDemand * 1.2,
  ) < 1e-6,
);
for (const experiment of [normal, late, price, surge]) {
  for (const option of experiment.options) {
    assert(
      Math.abs(
        option.evaluation.totalDemand -
          experiment.options[0].evaluation.totalDemand,
      ) < 1e-6,
      "Delivery extensions cannot hide any quantity",
    );
    assert(
      Math.abs(
        cashComponents(option).reduce((sum, row) => sum + row.value, 0) -
          option.costExcludingPenalty,
      ) < 1e-6,
      "Displayed cost components reconcile, penalty is excluded",
    );
    assert(
      Math.abs(
        option.evaluation.totalDelivered +
          option.evaluation.totalShortage -
          option.evaluation.totalDemand,
      ) < 1e-6,
    );
  }
}
const early = reactorSnapshot(base.plan, base.evaluation, 0);
assert.deepEqual(
  early.map((r) => r.status),
  ["Producing", "Producing", "Standby", "Standby"],
);
const cleaning = reactorSnapshot(base.plan, base.evaluation, 35);
assert.deepEqual(
  cleaning.map((r) => r.status),
  ["Cleaning", "Cleaning", "Producing", "Producing"],
);
const vcr = reactorSnapshot(base.plan, base.evaluation, 41);
assert(vcr.every((r) => r.status === "Producing"));
const hold = reactorSnapshot(
  late.options[0].plan,
  late.options[0].evaluation,
  6,
);
assert(hold.every((r) => r.status === "Material hold"));
const out = buildExecutiveExperiment({ ...zero, receiptDelay: 20 });
assert(
  out.options[0].evaluation.issues.some((i) => i.code === "event-horizon"),
);
const html = executiveBriefHtml({
  shock: zero,
  options: normal.options,
  selectedId: "hold",
  baselineCost: normal.cashLikeBase,
  reviewed: {},
  note: '<script>alert("unsafe")</script>',
});
assert(!html.includes('<script>alert("unsafe")</script>'));
assert(html.includes("&lt;script&gt;"));
assert(html.includes("NOT AN APPROVED FACTORY PLAN"));
console.log(
  "PASS: mock cost decomposition, price-only invariance, surge quantities, receipt recovery premium, common delivery tail, conserved demand and reactor/cleaning/material-hold states.",
);
console.log(
  JSON.stringify({
    baseService: base.evaluation.service,
    delayedService: late.options[0].evaluation.service,
    recoveredService: late.options[1].evaluation.service,
    baseCost: normal.cashLikeBase,
  }),
);
