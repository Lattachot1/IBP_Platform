// Inputs of the /optimize page and the exact request body they become
// (POST /api/v1/optimize). Pure functions - no React.

import { clamp } from '@/lib/format';
import { DEMAND_DEFAULT, GRADES } from './samplePlan';

// Bounds mirror OptimizeRequest in Backend/optimization/schemas.py so the
// page never sends a request the backend would reject with 422.
export const HORIZON_MIN = 7;
export const HORIZON_MAX = 190;          // fits 6 calendar months from any day
export const MONTHS_MIN = 1;
export const MONTHS_MAX = 6;
export const TIME_LIMIT_MIN = 5;
export const TIME_LIMIT_MAX = 300;

/** Every input the planner can edit — one field per OptimizeRequest field. */
export interface PlanForm {
  /** calendar months the plan spans; the horizon always ends on a month end */
  months: number;
  startDate: string;     // ISO date; '' lets the backend pick next Monday
  objective: string;
  holidays: string[];    // ISO dates; blank rows are dropped when sending
  initGrade: string;
  remainDays: number;
  rx12Age: number;
  rx34Age: number;
  timeLimitS: number;
  demand: Record<string, number>;
  /** plan per product from the planning data instead of `demand` */
  usePlanningData: boolean;
  /** group -> material -> tons; a group with any product above 0 takes their sum */
  productDemand: Record<string, Record<string, number>>;
}

// Changeover penalty per objective (tons-equivalent per changeover day),
// see OBJ_CHANGEOVER_PENALTY in Backend/optimization/engine.py.
export const OBJECTIVES = [
  { id: 'maximize_fulfilled', label: 'Maximize fulfilled demand', penalty: 2 },
  { id: 'balance', label: 'Balance', penalty: 60 },
  { id: 'minimize_changeover', label: 'Minimize changeovers', penalty: 400 },
];

export const BASE_FORM: PlanForm = {
  months: 3,
  startDate: '',
  objective: 'maximize_fulfilled',
  holidays: [],
  initGrade: 'BR150',
  remainDays: 2,
  rx12Age: 54,
  rx34Age: 0,
  timeLimitS: 60,
  demand: { ...DEMAND_DEFAULT },
  usePlanningData: false,
  productDemand: {},
};

export function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Same rule as engine._next_monday: today is never the start day. */
export function nextMondayIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const ahead = (1 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + ahead);
  return toIso(d);
}

/** The start the plan actually uses: the picked date, else the next Monday. */
export function planStartIso(f: PlanForm): string {
  return f.startDate || nextMondayIso();
}

/** First-of-month ISO `count` months from `startIso`'s month (count 0 = same month). */
export function monthStartIso(startIso: string, count: number): string {
  const year = Number(startIso.slice(0, 4));
  const month = Number(startIso.slice(5, 7));
  const total = month - 1 + count;
  return `${year + Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** Days from `startIso` through the last day of a `months`-month span
 * (2026-11-23 + 3 months runs through 2027-01-31 = 70 days). Noon on both
 * ends keeps any timezone offset out of the arithmetic. */
export function monthHorizonDays(startIso: string, months: number): number {
  const start = Date.parse(`${startIso}T12:00:00Z`);
  const afterLastMonth = Date.parse(`${monthStartIso(startIso, months)}T12:00:00Z`);
  return Math.round((afterLastMonth - start) / 86_400_000);
}

export function scaleDemand(base: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(base).forEach(([g, v]) => {
    out[g] = Math.round(v * factor);
  });
  return out;
}

const validTons = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v >= 0 ? v : 0);

/** The product rows of a group that carry demand (tons above 0). */
export function productRows(f: PlanForm, group: string): [string, number][] {
  return Object.entries(f.productDemand[group] ?? {}).filter(([, v]) => validTons(v) > 0);
}

/** True when the group's demand is the sum of its products. */
export function groupUsesProducts(f: PlanForm, group: string): boolean {
  return productRows(f, group).length > 0;
}

/** Demand of a group: the sum of its products when it has any, else the group field. */
export function groupDemand(f: PlanForm, group: string): number {
  const rows = productRows(f, group);
  return rows.length ? rows.reduce((sum, [, v]) => sum + v, 0) : validTons(f.demand[group]);
}

/** The exact JSON body for POST /api/v1/optimize (stable key order). */
export function buildRequest(f: PlanForm) {
  const demand: Record<string, number> = {};
  const productDemand: Record<string, number> = {};
  GRADES.forEach((g) => {
    demand[g.id] = groupDemand(f, g.id);
    if (!f.usePlanningData) productRows(f, g.id).forEach(([material, v]) => (productDemand[material] = v));
  });
  const months = clamp(f.months, MONTHS_MIN, MONTHS_MAX);
  const start = planStartIso(f);
  return {
    horizon_days: clamp(monthHorizonDays(start, months), HORIZON_MIN, HORIZON_MAX),
    start_date: start,
    objective: f.objective,
    demand,
    holidays: f.holidays.filter(Boolean),
    time_limit_s: clamp(f.timeLimitS, TIME_LIMIT_MIN, TIME_LIMIT_MAX),
    initial: {
      grade: f.initGrade,
      remain_days: clamp(f.remainDays, 0, HORIZON_MAX),
      rx12_age: clamp(f.rx12Age, 0, 365),
      rx34_age: clamp(f.rx34Age, 0, 365),
    },
    use_planning_data: f.usePlanningData,
    product_demand: productDemand,
  };
}

export interface Preset {
  id: string;
  label: string;
  hint: string;
  apply: (current: PlanForm) => PlanForm;
}

// Quick scenarios: each resets the plan inputs but keeps the calendar
// (start date + holidays) the planner already set.
export const PRESETS: Preset[] = [
  {
    id: 'base',
    label: 'Base',
    hint: 'Demo demand, 3 months, RX1-2 at age 54',
    apply: (c) => ({ ...BASE_FORM, startDate: c.startDate, holidays: c.holidays, demand: { ...DEMAND_DEFAULT } }),
  },
  {
    id: 'surge',
    label: 'Demand +20%',
    hint: 'Every grade +20% — expect shortages on the low-capacity grades',
    apply: (c) => ({ ...BASE_FORM, startDate: c.startDate, holidays: c.holidays, demand: scaleDemand(DEMAND_DEFAULT, 1.2) }),
  },
  {
    id: 'vcr',
    label: 'Heavy VCR',
    hint: 'VCR-412 1,500 t and VCR-617 2,000 t — forces a long VCR campaign on all four reactors',
    apply: (c) => ({
      ...BASE_FORM,
      startDate: c.startDate,
      holidays: c.holidays,
      demand: { ...DEMAND_DEFAULT, VCR412: 1500, VCR617: 2000 },
    }),
  },
  {
    id: 'clean',
    label: 'RX1-2 near cleaning',
    hint: 'RX1-2 already at age 58 — the 7-day cleaning is due within two days',
    apply: (c) => ({ ...BASE_FORM, startDate: c.startDate, holidays: c.holidays, demand: { ...DEMAND_DEFAULT }, rx12Age: 58 }),
  },
];
