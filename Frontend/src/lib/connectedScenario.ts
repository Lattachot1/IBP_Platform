import { executiveBase } from './executiveDemo';
import { evaluatePlan, GRADE_RULES, type ManualPlan, type PlanAssumptions } from './manualPlanning';
import type { Shipment } from './logisticsDemo';

export type ReceiptRoute = { origin: string; transitDays: number; freightPerTon: number; requiredDay?: number };
export type ScenarioSnapshot = { version: 2; plan: ManualPlan; assumptions: PlanAssumptions; routes: Record<string, ReceiptRoute> };
export const copyScenario = <T,>(value: T): T => structuredClone(value);
export function initialScenario(): ScenarioSnapshot {
  const seed = executiveBase();
  return { version: 2, plan: copyScenario(seed.plan), assumptions: copyScenario(seed.assumptions), routes: Object.fromEntries(seed.plan.purchases.map((p, i) => [p.id, { origin: i % 3 === 1 ? 'jp' : 'sg', transitDays: i % 3 === 1 ? 13 : 6, freightPerTon: i % 3 === 1 ? 82 : 48, requiredDay: p.start }])) };
}
export function evaluateScenario(snapshot: ScenarioSnapshot) {
  const { plan, assumptions } = snapshot;
  const evaluation = evaluatePlan(plan, assumptions);
  const remaining = new Map<string, number>();
  for (const day of evaluation.daily) for (const g of GRADE_RULES) {
    const required = plan.deliveries.filter(d => d.start === day.day && d.grade === g.id).reduce((s, d) => s + d.tons * (1 + assumptions.demandChange / 100), 0);
    remaining.set(`${day.day}:${g.id}`, Math.max(0, required - day.gradeShortage[g.id]));
  }
  // Attribute aggregate grade dispatch to orders in stable input order; never create cargo from unmet demand.
  const orders = plan.deliveries.map(d => {
    const key = `${d.start}:${d.grade}`, required = d.tons * (1 + assumptions.demandChange / 100);
    const fulfilled = Math.min(required, remaining.get(key) || 0);
    remaining.set(key, Math.max(0, (remaining.get(key) || 0) - fulfilled));
    return { ...d, required, fulfilled, unserved: required - fulfilled };
  });
  const inbound: Shipment[] = plan.purchases.map(p => {
    const route = snapshot.routes[p.id] || { origin: 'sg', transitDays: 6, freightPerTon: 48 };
    return { id: `IN:${p.id}`, direction: 'inbound', origin: route.origin, destination: 'th', partner: 'Illustrative supplier', product: 'Butadiene', tons: p.tons, departure: p.start - route.transitDays, transitDays: route.transitDays, dueDay: route.requiredDay ?? p.start, freightPerTon: route.freightPerTon };
  });
  const destinations = ['in', 'kr', 'cn', 'sg', 'nl', 'us'];
  const outbound: Shipment[] = orders.filter(d => d.fulfilled > 0).map(d => {
    const index = GRADE_RULES.findIndex(g => g.id === d.grade), transit = [12, 10, 9, 6, 32, 28][index];
    return { id: `OUT:${d.id}`, direction: 'outbound', origin: 'th', destination: destinations[index], partner: `Customer ${index + 1} (mock)`, product: d.grade, tons: d.fulfilled, departure: d.start, transitDays: transit, dueDay: d.start + transit, freightPerTon: [96, 75, 65, 48, 155, 170][index] };
  });
  const freight = inbound.filter(s => s.departure + s.transitDays >= 0 && s.departure + s.transitDays < plan.days).reduce((s, r) => s + r.tons * r.freightPerTon, 0) + outbound.reduce((s, r) => s + r.tons * r.freightPerTon, 0);
  const costBreakdown: Record<string, number> = { ...evaluation.costBreakdown, freight };
  const result = { ...evaluation, costBreakdown, cost: evaluation.cost + freight };
  return { evaluation: result, orders, shipments: [...inbound, ...outbound], costExcludingPenalty: result.cost - costBreakdown.shortagePenalty };
}
export function delayedReceipt(snapshot: ScenarioSnapshot, id: string, days: number): ScenarioSnapshot {
  const next = copyScenario(snapshot), receipt = next.plan.purchases.find(p => p.id === id);
  if (receipt) receipt.start = Math.max(0, receipt.start + days);
  return next;
}
export function bestAdjacentSwap(snapshot: ScenarioSnapshot) {
  const reference = evaluateScenario(snapshot);
  let best = snapshot, outcome = reference, tested = 0;
  const campaigns = [...snapshot.plan.campaigns].sort((a, b) => a.start - b.start);
  for (let i = 0; i < campaigns.length - 1; i++) {
    const left = campaigns[i], right = campaigns[i + 1], gap = right.start - left.start - left.duration;
    if (gap < 0) continue;
    const candidate = copyScenario(snapshot);
    candidate.plan.campaigns.find(c => c.id === right.id)!.start = left.start;
    candidate.plan.campaigns.find(c => c.id === left.id)!.start = left.start + right.duration + gap;
    const scored = evaluateScenario(candidate);
    tested++;
    const conflicts = scored.evaluation.issues.filter(i => i.severity === 'conflict').length;
    const existingConflicts = reference.evaluation.issues.filter(i => i.severity === 'conflict').length;
    if (conflicts <= existingConflicts && (scored.evaluation.totalShortage < outcome.evaluation.totalShortage - 1e-6 || (Math.abs(scored.evaluation.totalShortage - outcome.evaluation.totalShortage) < 1e-6 && scored.costExcludingPenalty < outcome.costExcludingPenalty - 1e-6))) {
      best = candidate; outcome = scored;
    }
  }
  return { snapshot: best, outcome, tested, improved: best !== snapshot };
}
export function validScenario(value: unknown): value is ScenarioSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as ScenarioSnapshot, grades = new Set(GRADE_RULES.map(g => g.id));
  const finite = (n: unknown, min = 0) => typeof n === 'number' && Number.isFinite(n) && n >= min;
  if (s.version !== 2 || s.plan?.startDate !== '2026-09-01' || s.plan.days !== 68 || !s.assumptions || !s.routes) return false;
  if (![s.plan.campaigns, s.plan.purchases, s.plan.deliveries, s.plan.cleanings].every(rows => Array.isArray(rows) && rows.length <= 200)) return false;
  if (![...s.plan.campaigns, ...s.plan.purchases, ...s.plan.deliveries, ...s.plan.cleanings].every(row => row && typeof row === 'object' && typeof row.id === 'string')) return false;
  if (!s.plan.campaigns.every(c => typeof c.id === 'string' && grades.has(c.grade) && Number.isInteger(c.start) && c.start >= 0 && Number.isInteger(c.duration) && c.duration > 0 && c.start + c.duration <= s.plan.days)) return false;
  if (!s.plan.purchases.every(p => typeof p.id === 'string' && Number.isInteger(p.start) && p.start >= 0 && finite(p.tons) && (p.price === null || finite(p.price)))) return false;
  if (!s.plan.deliveries.every(d => grades.has(d.grade) && typeof d.id === 'string' && Number.isInteger(d.start) && d.start >= 0 && d.start < s.plan.days && finite(d.tons))) return false;
  if (!s.plan.cleanings.every(c => ['RX1+RX2', 'RX3+RX4'].includes(c.pair) && Number.isInteger(c.start) && c.start >= 0 && Number.isInteger(c.duration) && c.duration > 0 && c.start + c.duration <= s.plan.days)) return false;
  for (const rows of [s.plan.campaigns, s.plan.purchases, s.plan.deliveries, s.plan.cleanings]) if (new Set(rows.map(r => r.id)).size !== rows.length) return false;
  if (!GRADE_RULES.every(g => finite(s.assumptions.initialStock?.[g.id]))) return false;
  if (!['initialRaw', 'rawCapacity', 'rawHoldingDaily', 'fgHoldingDaily', 'shortagePenalty', 'productionCost', 'setupCost', 'age12', 'age34'].every(key => finite(s.assumptions[key as keyof PlanAssumptions])) || !finite(s.assumptions.demandChange, -99)) return false;
  if (!Number.isInteger(s.assumptions.lag) || s.assumptions.lag < 0 || s.assumptions.lag > 30 || !Array.isArray(s.assumptions.holidays) || !s.assumptions.holidays.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) || !s.assumptions.monthlyPrices || typeof s.assumptions.monthlyPrices !== 'object' || !Object.values(s.assumptions.monthlyPrices).every(n => finite(n))) return false;
  if (typeof s.routes !== 'object' || Array.isArray(s.routes)) return false;
  return Object.values(s.routes).every(r => r && typeof r === 'object' && ['sg', 'jp', 'kr', 'cn', 'in', 'nl', 'us', 'th'].includes(r.origin) && Number.isInteger(r.transitDays) && r.transitDays >= 1 && r.transitDays <= 90 && finite(r.freightPerTon) && (r.requiredDay === undefined || (Number.isInteger(r.requiredDay) && r.requiredDay >= 0)));
}
