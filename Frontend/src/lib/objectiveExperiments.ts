import { DEFAULT_OBJECTIVE_WEIGHTS, OBJECTIVE_TERMS, normalizeOptimizationRequest, type ObjectiveTerm, type OptimizationDemoRequest, type OptimizationDemoResponse } from './optimizationApi';

export type BusinessMetrics = {
  expense: number; penalties: number; service: number; shortage: number;
  finishedStock: number; rawStock: number; purchase: number; production: number; overtime: number;
};
export function businessMetrics(result: OptimizationDemoResponse): BusinessMetrics {
  const p = result.selected_plan;
  const expense = p.expected_operating_cost ?? OBJECTIVE_TERMS.filter(t => t.kind === 'expense').reduce((s, t) => s + (p.cost_breakdown[t.key] || 0), 0);
  return {
    expense, penalties: p.expected_penalty_cost ?? OBJECTIVE_TERMS.filter(t => t.kind === 'penalty').reduce((s, t) => s + (p.cost_breakdown[t.key] || 0), 0),
    service: p.expected_service_level_pct, shortage: p.expected_shortage_tons,
    finishedStock: p.product_plan.reduce((s, row) => s + row.expected_ending_inventory_tons, 0),
    rawStock: p.monthly_plan.at(-1)?.ending_raw_inventory_tons || 0,
    purchase: p.total_purchase_tons, production: p.monthly_plan.reduce((s, row) => s + row.planned_production_tons, 0),
    overtime: p.total_overtime_tons,
  };
}
export function frozenInputKey(input: OptimizationDemoRequest, varying?: ObjectiveTerm): string {
  const normalized = normalizeOptimizationRequest(input);
  if (varying) normalized.objective_weights = { ...normalized.objective_weights!, [varying]: 0 };
  return JSON.stringify(normalized);
}
export function matchingModel(a: OptimizationDemoResponse, b: OptimizationDemoResponse): boolean {
  return !!a.model_signature && a.model_signature === b.model_signature
    && JSON.stringify(a.horizon) === JSON.stringify(b.horizon)
    && JSON.stringify(a.scenario_definitions) === JSON.stringify(b.scenario_definitions)
    && a.currency === b.currency && a.unit === b.unit;
}
export function comparableTrial(reference: OptimizationDemoResponse, trial: OptimizationDemoResponse, term: ObjectiveTerm): boolean {
  return matchingModel(reference, trial) && frozenInputKey(reference.input, term) === frozenInputKey(trial.input, term);
}
export function inputChanges(before: OptimizationDemoResponse, after: OptimizationDemoResponse) {
  const a = normalizeOptimizationRequest(before.input), b = normalizeOptimizationRequest(after.input);
  const fields = ['strategy', 'demand_adjustment_pct', 'capacity_adjustment_pct', 'raw_price_adjustment_pct', 'shortage_penalty_multiplier', 'service_target_pct'] as const;
  return {
    conditions: [...fields.filter(key => a[key] !== b[key]), ...(JSON.stringify(a.holding_costs) !== JSON.stringify(b.holding_costs) ? ['holding_costs'] : [])],
    weights: OBJECTIVE_TERMS.filter(t => a.objective_weights![t.key] !== b.objective_weights![t.key]).map(t => ({ ...t, before: a.objective_weights![t.key], after: b.objective_weights![t.key] })),
    modelMatches: matchingModel(before, after),
  };
}
export function trialRequest(input: OptimizationDemoRequest, term: ObjectiveTerm, level: number): OptimizationDemoRequest {
  if (!OBJECTIVE_TERMS.some(t => t.key === term)) throw new Error('Unknown objective term');
  if (!Number.isFinite(level) || level < 0 || level > 20) throw new Error('Weight level must be between 0 and 20');
  const next = normalizeOptimizationRequest(input);
  next.objective_weights = { ...DEFAULT_OBJECTIVE_WEIGHTS, ...next.objective_weights, [term]: level };
  if (!Object.values(next.objective_weights).some(v => v > 0)) throw new Error('All objective weights would be zero');
  return next;
}
export function dominates(a: BusinessMetrics, b: BusinessMetrics): boolean {
  return a.expense <= b.expense + 0.1 && a.shortage <= b.shortage + 0.1
    && (a.expense < b.expense - 0.1 || a.shortage < b.shortage - 0.1);
}
export function reportedPlanKey(result: OptimizationDemoResponse): string {
  const p = result.selected_plan;
  return JSON.stringify([p.monthly_plan, p.product_plan, p.scenario_outcomes, p.cost_breakdown]);
}
export function tradeoff(reference: BusinessMetrics, candidate: BusinessMetrics) {
  const extraExpense = candidate.expense - reference.expense;
  const additionalDispatch = reference.shortage - candidate.shortage;
  return {
    extraExpense, additionalDispatch,
    expensePerAdditionalTon: additionalDispatch > 0.1 && extraExpense > 0.1 ? extraExpense / additionalDispatch : null,
    lowerExpenseWithLostSales: extraExpense < -0.1 && additionalDispatch < -0.1,
  };
}
