// What-if simulation types (POST /api/simulate, /api/scenarios/save, GET /api/scenarios)

/** One simulated scenario, as computed and stored by the backend. */
export interface ScenarioResult {
  scenario_id?: number;
  scenario_name: string;
  base_demand: number;
  demand_change_pct: number;
  forecast_demand: number;
  lower_bound: number;
  upper_bound: number;
  capacity_limit: number;
  enable_ot: boolean;
  actual_produce: number;
  shortage_qty: number;
  service_level_pct: number;
  revenue_thb: number;
  extra_cost_thb: number;
  constraint_status: string;
  model_name: string;
  created_by: string;
  created_at?: string;
}

/** What-if inputs; every figure on the page is computed from them by the backend. */
export interface SimulationInputs {
  scenario_name: string;
  base_demand: number;
  demand_change_pct: number;
  enable_ot: boolean;
  created_by: string;
}
