const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { trialRequest, frozenInputKey, matchingModel, comparableTrial, businessMetrics, dominates, tradeoff, inputChanges } = require('../src/lib/objectiveExperiments.ts');
const { normalizeOptimizationRequest } = require('../src/lib/optimizationApi.ts');
const input = normalizeOptimizationRequest({ strategy: 'stochastic', demand_adjustment_pct: 0, capacity_adjustment_pct: 0, raw_price_adjustment_pct: 0, shortage_penalty_multiplier: 1, service_target_pct: 95 });
const original = JSON.stringify(input), tested = trialRequest(input, 'shortage', 5);
assert.equal(JSON.stringify(input), original);
assert.equal(tested.objective_weights.shortage, 5);
assert.equal(frozenInputKey(tested, 'shortage'), frozenInputKey(input, 'shortage'));
assert.notEqual(frozenInputKey(tested), frozenInputKey(input));
const fixture = {
  input, model_signature: 'a'.repeat(64), horizon: ['2026-09', '2026-10'], scenario_definitions: [{ scenario: 'base', probability: 1 }], currency: 'USD', unit: 'metric_ton',
  selected_plan: { expected_operating_cost: 1000, expected_penalty_cost: 100, expected_service_level_pct: 90, expected_shortage_tons: 10, total_purchase_tons: 70, total_overtime_tons: 0, product_plan: [{ expected_ending_inventory_tons: 20 }], monthly_plan: [{ planned_production_tons: 80, ending_raw_inventory_tons: 5 }], cost_breakdown: { raw_material: 900, production: 100, shortage: 100 } },
};
const trial = { ...structuredClone(fixture), input: tested };
assert(comparableTrial(fixture, trial, 'shortage'));
assert.equal(inputChanges(fixture, trial).weights[0].key, 'shortage');
for (const mutate of [r => r.model_signature = 'b'.repeat(64), r => r.input.capacity_adjustment_pct = -5, r => r.input.objective_weights.production = 2, r => r.scenario_definitions[0].probability = 0.5, r => r.horizon.push('2026-11')]) {
  const changed = structuredClone(trial); mutate(changed); assert.equal(comparableTrial(fixture, changed, 'shortage'), false);
}
const old = structuredClone(fixture); delete old.model_signature;
assert.equal(matchingModel(old, old), false, 'Missing provenance must not be silently considered a match');
const metrics = businessMetrics(fixture);
assert.equal(metrics.expense, 1000); assert.equal(metrics.shortage, 10); assert.equal(metrics.finishedStock, 20); assert.equal(metrics.rawStock, 5);
const legacy = structuredClone(fixture); delete legacy.selected_plan.expected_operating_cost; delete legacy.selected_plan.expected_penalty_cost;
assert.equal(businessMetrics(legacy).expense, 1000);
const better = { ...metrics, expense: 900, shortage: 5 }, worse = { ...metrics, expense: 1100, shortage: 20 };
assert(dominates(better, metrics)); assert.equal(dominates(metrics, metrics), false);
assert.equal(dominates({ ...metrics, expense: 1100, shortage: 0 }, metrics), false, 'More service for more expense is a tradeoff, not dominance');
assert.equal(tradeoff(metrics, { ...metrics, expense: 1200, shortage: 5 }).expensePerAdditionalTon, 40);
assert.equal(tradeoff(metrics, { ...metrics, expense: 900, shortage: 20 }).lowerExpenseWithLostSales, true);
assert.equal(tradeoff(metrics, { ...metrics, expense: 900 }).expensePerAdditionalTon, null);
for (const value of [NaN, Infinity, -1, 21]) assert.throws(() => trialRequest(input, 'shortage', value));
const onlyShortage = { ...input, objective_weights: Object.fromEntries(Object.keys(input.objective_weights).map(k => [k, k === 'shortage' ? 1 : 0])) };
assert.throws(() => trialRequest(onlyShortage, 'shortage', 0));
assert.equal(JSON.stringify(input), original);
console.log('PASS: frozen requests, version/scenario guards, money extraction, input attribution, Pareto subset logic and physical tradeoffs.');
