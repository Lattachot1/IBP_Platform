const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { forecastSourceCurrent, stableInput } = require('../src/lib/integratedPlanning.ts');
const input = {
  plant: { start_date: '2026-10-01', horizon_days: 7, holidays: [] },
  firm_demand: { BR150: [10, 0, 0, 0, 0, 0, 0], BR150B: [0, 0, 0, 0, 0, 0, 0] },
  forecast_residual: { BR150: [5, 5, 5, 5, 5, 5, 5], BR150B: [1, 1, 1, 1, 1, 1, 1] },
};
assert.equal(forecastSourceCurrent(input), false);
input.demand_source = { start_date: '2026-10-01', horizon_days: 7, allocation: 'calendar_days', holidays: [], grades: [{ grade: 'BR150', firm_used: [...input.firm_demand.BR150], residual_allocated: [...input.forecast_residual.BR150] }] };
const original = stableInput(input);
assert(forecastSourceCurrent(input));
for (const mutate of [x => x.firm_demand.BR150[0]++, x => x.forecast_residual.BR150[0]++, x => x.plant.start_date = '2026-10-02', x => x.plant.horizon_days = 8]) {
  const changed = structuredClone(input); mutate(changed); assert.equal(forecastSourceCurrent(changed), false);
}
for (const mutate of [x => x.raw_prices = [1234], x => x.day_locks = [{ day: 0, grade: 'BR150' }], x => x.forecast_residual.BR150B[0]++, x => x.plant.holidays = ['2026-10-02']]) {
  const changed = structuredClone(input); mutate(changed); assert.equal(forecastSourceCurrent(changed), true);
}
const working = structuredClone(input); working.demand_source.allocation = 'working_days'; working.plant.holidays = ['2026-10-02'];
assert.equal(forecastSourceCurrent(working), false);
assert.equal(stableInput(input), original, 'Provenance checks cannot mutate input or captured arrays');
console.log('PASS: forecast snapshot alignment, manual-edit detection, calendar guards and unrelated-input preservation.');
