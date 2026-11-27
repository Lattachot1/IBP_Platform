// Inputs of the /optimize page and the exact request body they become
// (POST /api/v1/optimize). Pure functions - no React.

import { clamp } from '@/lib/format';
import { DEMAND_DEFAULT } from './samplePlan';

// Bounds mirror OptimizeRequest in Backend/optimization/schemas.py so the
// page never sends a request the backend would reject with 422.
export const HORIZON_MIN = 7;
export const HORIZON_MAX = 190;          // fits 6 calendar months from any day
export const MONTHS_MIN = 1;
export const MONTHS_MAX = 6;
export const TIME_LIMIT_MIN = 5;
export const TIME_LIMIT_MAX = 300;

/** ISO month start -> material number -> editable demand total in tons. */
export type MonthlyDemand = Record<string, Record<string, string>>;

/** The inputs the planner can edit. */
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
  monthlyDemand: MonthlyDemand;
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
  monthlyDemand: {},
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

export function demandMonths(f: PlanForm): string[] {
  const start = planStartIso(f);
  return Array.from({ length: clamp(f.months, MONTHS_MIN, MONTHS_MAX) }, (_, i) => monthStartIso(start, i));
}

export function demandError(raw: string, floor: number): string | null {
  if (raw.trim() === '') return null;
  const tons = Number(raw);
  if (!Number.isFinite(tons) || tons < 0) return 'Enter a non-negative number of tons.';
  if (tons < floor - 1e-9) return 'Demand is below actual orders.';
  return null;
}

/** The exact JSON body for POST /api/v1/optimize (stable key order). */
export function buildRequest(f: PlanForm) {
  const monthlyDemand: Record<string, Record<string, number>> = {};
  const months = demandMonths(f);
  const start = planStartIso(f);
  for (const month of months) {
    const values = Object.entries(f.monthlyDemand[month] ?? {})
      .filter(([, value]) => value.trim() !== '')
      .sort(([material], [otherMaterial]) => material.localeCompare(otherMaterial));
    if (values.length) {
      monthlyDemand[month] = Object.fromEntries(values.map(([material, value]) => [material, Number(value)]));
    }
  }
  return {
    horizon_days: clamp(monthHorizonDays(start, months.length), HORIZON_MIN, HORIZON_MAX),
    start_date: start,
    objective: f.objective,
    holidays: f.holidays.filter(Boolean),
    time_limit_s: clamp(f.timeLimitS, TIME_LIMIT_MIN, TIME_LIMIT_MAX),
    initial: {
      grade: f.initGrade,
      remain_days: clamp(f.remainDays, 0, HORIZON_MAX),
      rx12_age: clamp(f.rx12Age, 0, 365),
      rx34_age: clamp(f.rx34Age, 0, 365),
    },
    use_planning_data: true,
    monthly_product_demand: monthlyDemand,
  };
}

export interface DemoScenario {
  form: PlanForm;
  gradeDemand: MonthlyDemand;
}

export interface Preset {
  id: string;
  label: string;
  hint: string;
  apply: (current: PlanForm) => DemoScenario;
}

// Spread a demo scenario's horizon totals over its three calendar months.
function demoScenario(current: PlanForm, totals = DEMAND_DEFAULT): DemoScenario {
  const next = { ...BASE_FORM, startDate: current.startDate, holidays: current.holidays };
  const months = demandMonths(next);
  const gradeDemand = Object.fromEntries(months.map((month, i) => [
    month,
    Object.fromEntries(Object.entries(totals).map(([grade, tons]) => [
      grade,
      String(Math.floor(tons / months.length) + Number(i < tons % months.length)),
    ])),
  ]));
  return { form: next, gradeDemand };
}

export const PRESETS: Preset[] = [
  {
    id: 'base',
    label: 'Base',
    hint: 'Demo demand, 3 months, RX1-2 at age 54',
    apply: (c) => demoScenario(c),
  },
  {
    id: 'surge',
    label: 'Demand +20%',
    hint: 'Every demo grade +20%',
    apply: (c) => demoScenario(c, scaleDemand(DEMAND_DEFAULT, 1.2)),
  },
  {
    id: 'vcr',
    label: 'Heavy VCR',
    hint: 'VCR-412 1,500 t and VCR-617 2,000 t over the plan',
    apply: (c) => demoScenario(c, { ...DEMAND_DEFAULT, VCR412: 1500, VCR617: 2000 }),
  },
  {
    id: 'clean',
    label: 'RX1-2 near cleaning',
    hint: 'RX1-2 already at age 58 — the 7-day cleaning is due within two days',
    apply: (c) => {
      const scenario = demoScenario(c);
      return { ...scenario, form: { ...scenario.form, rx12Age: 58 } };
    },
  },
];
