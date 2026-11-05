// Response types of POST /api/v1/optimize and /api/v1/optimize/evaluate.
// They mirror the backend (Backend/optimization/engine.py, manual.py) one
// to one; the offline sample in samplePlan.ts uses the same shapes.

export interface GradeMeta {
  id: string;
  disp: string;
  slot: number;
}

export interface DayPart {
  grade: string;
  tons: number;
}

export type PairStatus = 'prod' | 'clean' | 'idle';

export interface ReactorCell {
  id: string;
  status: PairStatus;
  parts: DayPart[];
}

export interface PlanDay {
  iso: string;
  date: string;
  wd: string;
  wknd: boolean;
  chg: boolean;
  cap: number | null;
  parts: DayPart[];
  p1: PairStatus;
  p2: PairStatus;
  reactors: ReactorCell[];
  rx: string;
  note: string;
  conflict?: boolean;   // evaluator only: a rule is broken on this day
}

export interface CheckItem {
  level: 'ok' | 'warn' | 'conflict';
  text: string;
  days?: number[];      // evaluator only: day indexes involved
}

export interface Kpis {
  status: string;
  total_tons: number;
  fulfillment_pct: number;
  shortage_tons: number;
  changeover_days: number;
  solve_s: number;
}

export interface FulfillRow {
  grade: string;
  disp: string;
  slot: number;
  produced: number;
  demand: number;
  shortage: number;
}

export interface OptimizeResult {
  status: string;        // 'feasible' | 'infeasible' | 'unknown' | 'conflicts' (evaluator)
  mode: string;          // 'cspat' | 'sample' | 'manual'
  message?: string;      // set when status is not 'feasible'
  conflicts?: number;    // evaluator only
  solve_s: number;
  horizon_days: number;
  start_date: string;
  grades: GradeMeta[];
  demand_used: Record<string, number>;
  kpis: Kpis;
  fulfillment: FulfillRow[];
  days: PlanDay[];
  pair_notes: Record<string, string>;
  checks: CheckItem[];
  assumptions: string[];
}
