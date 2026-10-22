import type { HoldingCosts } from './optimizationApi';
import type { OptimizeResult } from '../components/plant/samplePlan';

export const PILOT_GRADES = ['BR150', 'BR150L', 'BR150B', 'BR360B', 'VCR412', 'VCR617'];
export const PILOT_WEIGHTS = ['raw_material', 'production', 'setup', 'finished_goods_holding', 'raw_material_holding', 'shortage'];
export interface Receipt { day: number; tons: number; }
export interface DayLock { day: number; grade: string; production?: Record<string, number> | null; rx12?: string | null; rx34?: string | null; }
export interface ForecastMonth {
  period: string; horizon_step: number; point_tons: number; lower_tons: number; upper_tons: number; selected_monthly_tons: number;
  eligible_days_in_month: number; eligible_days_in_window: number; partial_month: boolean;
  target_window_tons: number; firm_window_tons: number; residual_window_tons: number; rounding_adjustment_tons: number;
}
export interface ForecastSource {
  origin: 'billing_monthly_forecast'; snapshot_id: string; trained_at: string; captured_at: string;
  start_date: string; horizon_days: number; path: 'point' | 'lower' | 'upper'; allocation: 'calendar_days' | 'working_days';
  partial_month_policy: 'prorate' | 'reject'; firm_orders_mode: 'preserve' | 'clear'; holidays: string[];
  grades: { grade: string; product_id: string; model_name: string; trained_through: string; interval_level_pct: number; coverage_empirical: number | null; months: ForecastMonth[]; firm_used: number[]; residual_allocated: number[] }[];
  manual_grades: string[]; warnings: string[]; status: 'applied' | 'modified'; manual_override_acknowledged: boolean;
}
export interface ForecastAvailability {
  trained_at: string; models: { grade: string; product_id: string; trained_through: string; model_name: string }[];
  manual_grades: string[]; earliest_common_month: string | null;
}
export interface IntegratedInput {
  plant: { start_date: string; horizon_days: number; objective: string; full_rate: boolean; demand: Record<string, number> | null; holidays: string[]; time_limit_s: number; initial: { grade: string; remain_days: number; rx12_age: number; rx34_age: number; vcr_elapsed_days: number } };
  policy: 'weighted_cost' | 'delivery_first';
  release_lag_days: number; purchase_lead_days: number;
  opening_fg: Record<string, number>; opening_raw_tons: number; raw_storage_tons: number; purchase_limit_tons_per_day: number;
  bom_kg_per_ton: Record<string, number>; firm_demand: Record<string, number[]>; forecast_residual: Record<string, number[]>;
  raw_prices: number[]; holding_costs: HoldingCosts; weights: Record<string, number>;
  raw_pipeline: Receipt[]; fg_pipeline: (Receipt & { grade: string })[]; day_locks: DayLock[]; purchase_locks: Receipt[]; input_note: string;
  demand_source?: ForecastSource | null;
}
export interface IntegratedDay {
  date: string; purchase_tons: number; receipt_tons: number; raw_consumed_tons: number; raw_stock_tons: number;
  releases: Record<string, number>; dispatch: Record<string, number>; firm_dispatch: Record<string, number>;
  shortage: Record<string, number>; fg_stock: Record<string, number>; production_tons: number; demand_tons: number;
}
export interface IntegratedResult extends OptimizeResult {
  input: IntegratedInput; input_signature?: string; model_signature?: string; overtime_allowed: false;
  integration?: {
    demand_source_status?: 'applied' | 'modified';
    daily: IntegratedDay[]; stages: { goal: string; status: string; value: number | null; best_bound: number | null; proven_optimal: boolean; unit: string }[];
    cost_breakdown: Record<string, number>; weighted_score: number; operating_cost_usd: number; modeled_shortage_loss_usd: number;
    demand_tons: number; shortage_tons: number; dispatch_tons: number; fulfillment_pct: number; firm_shortage_tons: number;
    closing_fg_tons: number; closing_raw_tons: number; closing_wip_tons: number; wip_releases_after_horizon: { grade: string; tons: number; release_date: string }[];
    holding_checkpoints: string[]; locks_honored: { production_days: number; purchase_days: number }; optimality_proven: boolean;
  };
}
export const evenSpread = (total: number, days: number) => Array.from({ length: days }, (_, i) => Math.floor(total / days) + (i < total % days ? 1 : 0));
export function forecastSourceCurrent(input: IntegratedInput): boolean {
  const s = input.demand_source;
  return !!s && s.start_date === input.plant.start_date && s.horizon_days === input.plant.horizon_days
    && (s.allocation !== 'working_days' || stableInput([...s.holidays].sort()) === stableInput([...input.plant.holidays].sort()))
    && s.grades.every(g => stableInput(input.firm_demand[g.grade]) === stableInput(g.firm_used) && stableInput(input.forecast_residual[g.grade]) === stableInput(g.residual_allocated));
}
export function stableInput(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableInput).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + stableInput(v)).join(',') + '}';
  return JSON.stringify(value);
}
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
export async function pilotApi<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(API + '/api/v1/planning/' + path, data === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json(); detail = typeof body.detail === 'string' ? body.detail : body.detail?.map((x: { loc: string[]; msg: string }) => x.loc.join('.') + ': ' + x.msg).join('; '); } catch { /* HTTP status remains visible. */ }
    throw new Error(`Planning API ${response.status}: ${detail || response.statusText}`);
  }
  return response.json();
}
