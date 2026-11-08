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
  products?: ProductTons[];   // use_planning_data only: the day's output per product
}

export interface ProductTons {
  material_no: string;
  tons: number;
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
  planning?: PlanningSection;   // use_planning_data only
  product_fulfillment?: ProductFulfillRow[];   // product_demand only
}

/** Output shared over the products a group's demand was broken into. */
export interface ProductFulfillRow {
  material_no: string;
  description: string;
  group: string;
  demand: number;
  produced: number;
  shortage: number;
}

/** GET /api/v1/optimize/catalog — the groups with their active products. */
export interface CatalogProduct {
  material_no: string;
  description: string;
  min_stock_tons: number;
}

export interface CatalogGroup extends GradeMeta {
  products: CatalogProduct[];
}

// ---- product-level planning (Backend/optimization/planning.py report) ----

export type OrderStatus = 'on_time' | 'late' | 'not_covered' | 'after_horizon';

export interface PlannedOrder {
  order_no: string;
  item_no: number;
  material_no: string;
  open_tons: number;
  due_date: string;
  ready_date: string | null;
  late_days: number | null;
  status: OrderStatus;
  in_horizon: boolean;
}

/** Daily arrays have one value per plan day. */
export interface PlannedProduct {
  material_no: string;
  description: string;
  group: string;
  min_stock: number;
  start_stock: number;
  qc_release: number[];
  shipped: number[];
  produced: number[];
  stock: number[];
  end_stock: number;
  days_below_min: number;
  share: number;
  lookahead_tons: number;
  /** net requirement over the horizon (orders due + minimum stock + forecast share − stock − lots in QC) */
  requirement: number;
  /** the part of the requirement the plan does not produce */
  shortage: number;
}

export interface ForecastMonthRow {
  group: string;
  month: string;
  source: string;
  forecast: number;
  ordered: number;
  not_yet_ordered: number;
  share_in_horizon: number;
  to_produce: number;
  deadline: string;
  short_tons: number;
}

export interface PlanningKpis {
  orders_in_horizon: number;
  orders_on_time: number;
  orders_late: number;
  orders_not_covered: number;
  on_time_pct: number;
  on_time_tons_pct: number;
  late_ton_days: number;
  below_min_ton_days: number;
  forecast_short_tons: number;
}

export interface PlanningSection {
  snapshot_date: string | null;
  qc_days: number;
  kpis: PlanningKpis;
  products: PlannedProduct[];
  orders: PlannedOrder[];
  forecast: ForecastMonthRow[];
  warnings: string[];
  unallocated_tons?: Record<string, number>;
}
