// Domain checks run without a browser or private APIs.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { initialScenario, evaluateScenario, delayedReceipt, bestAdjacentSwap, copyScenario, validScenario } = require('../src/lib/connectedScenario.ts');
const { evaluatePlan } = require('../src/lib/manualPlanning.ts');
const seed = initialScenario(), normal = evaluateScenario(seed), shock = delayedReceipt(seed, seed.plan.purchases[0].id, 7), stressed = evaluateScenario(shock);
assert(validScenario(seed));
assert(validScenario(shock));
assert.equal(seed.plan.purchases[0].start, 0);
assert.equal(shock.plan.purchases[0].start, 7);
assert.deepEqual(shock.plan.purchases.slice(1), seed.plan.purchases.slice(1));
const close = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
for (const snapshot of [seed, shock]) {
  const result = evaluateScenario(snapshot), original = evaluatePlan(snapshot.plan, snapshot.assumptions);
  const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
  close(sum(result.orders, 'required'), result.evaluation.totalDemand);
  close(sum(result.orders, 'fulfilled'), result.evaluation.totalDelivered);
  close(sum(result.orders, 'unserved'), result.evaluation.totalShortage);
  close(sum(result.shipments.filter(r => r.direction === 'outbound'), 'tons'), result.evaluation.totalDelivered);
  for (const p of snapshot.plan.purchases) {
    const ship = result.shipments.find(s => s.id === `IN:${p.id}`);
    assert.equal(ship.departure + ship.transitDays, p.start);
  }
  close(result.evaluation.cost, original.cost + result.evaluation.costBreakdown.freight);
  close(result.costExcludingPenalty, result.evaluation.cost - result.evaluation.costBreakdown.shortagePenalty);
  assert(result.orders.every(o => o.fulfilled >= 0 && o.fulfilled <= o.required));
  assert(result.evaluation.daily.every(d => d.fg >= -1e-6 && d.raw >= -1e-6));
}
assert.equal(stressed.shipments[0].dueDay, 0, 'Delay must not silently move the original receipt deadline');
const repair = bestAdjacentSwap(shock);
assert.deepEqual(repair.snapshot.plan.deliveries, shock.plan.deliveries);
assert.deepEqual(repair.snapshot.plan.purchases, shock.plan.purchases);
assert(repair.outcome.evaluation.totalShortage <= stressed.evaluation.totalShortage + 1e-6);
assert(repair.outcome.evaluation.issues.filter(i => i.severity === 'conflict').length <= stressed.evaluation.issues.filter(i => i.severity === 'conflict').length);
for (const c of seed.plan.campaigns) assert.equal(repair.snapshot.plan.campaigns.find(r => r.id === c.id).duration, c.duration);
for (const mutate of [s => s.routes.x = null, s => s.plan.deliveries[0] = null, s => s.assumptions.monthlyPrices = null, s => s.plan.purchases[0].tons = NaN, s => s.plan.deliveries[0].start = 68]) {
  const invalid = copyScenario(seed); mutate(invalid); assert.equal(validScenario(invalid), false);
}
console.log(JSON.stringify({ status: 'passed', baselineService: normal.evaluation.service, delayedService: stressed.evaluation.service, baselineShortage: normal.evaluation.totalShortage, delayedShortage: stressed.evaluation.totalShortage, testedSwapService: repair.outcome.evaluation.service, swapsTested: repair.tested, productionLoss: normal.evaluation.totalProduced - stressed.evaluation.totalProduced }));
