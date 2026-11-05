// Inputs of the /optimize page and the exact request body they become
// (POST /api/v1/optimize). Pure functions - no React.

import { clamp } from '@/lib/format';
import { DEMAND_DEFAULT, GRADES } from './samplePlan';

// Bounds mirror OptimizeRequest in Backend/optimization/schemas.py so the
// page never sends a request the backend would reject with 422.
export const HORIZON_MIN = 7;
export const HORIZON_MAX = 120;
export const TIME_LIMIT_MIN = 5;
export const TIME_LIMIT_MAX = 300;

/** Every input the planner can edit — one field per OptimizeRequest field. */
export interface PlanForm {
  horizonDays: number;
  startDate: string;     // ISO date; '' lets the backend pick next Monday
  objective: string;
  holidays: string[];    // ISO dates; blank rows are dropped when sending
  initGrade: string;
  remainDays: number;
  rx12Age: number;
  rx34Age: number;
  timeLimitS: number;
  demand: Record<string, number>;
}

// Changeover penalty per objective (tons-equivalent per changeover day),
// see OBJ_CHANGEOVER_PENALTY in Backend/optimization/engine.py.
export const OBJECTIVES = [
  { id: 'maximize_fulfilled', label: 'Maximize fulfilled demand', penalty: 2 },
  { id: 'balance', label: 'Balance', penalty: 60 },
  { id: 'minimize_changeover', label: 'Minimize changeovers', penalty: 400 },
];

export const BASE_FORM: PlanForm = {
  horizonDays: 28,
  startDate: '',
  objective: 'maximize_fulfilled',
  holidays: [],
  initGrade: 'BR150',
  remainDays: 2,
  rx12Age: 54,
  rx34Age: 0,
  timeLimitS: 30,
  demand: { ...DEMAND_DEFAULT },
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

export function scaleDemand(base: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(base).forEach(([g, v]) => {
    out[g] = Math.round(v * factor);
  });
  return out;
}

/** The exact JSON body for POST /api/v1/optimize (stable key order). */
export function buildRequest(f: PlanForm) {
  const demand: Record<string, number> = {};
  GRADES.forEach((g) => {
    const v = f.demand[g.id];
    demand[g.id] = Number.isFinite(v) && v >= 0 ? v : 0;
  });
  return {
    horizon_days: clamp(f.horizonDays, HORIZON_MIN, HORIZON_MAX),
    start_date: f.startDate,
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
    hint: 'Demo demand, 28 days, RX1-2 at age 54',
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
