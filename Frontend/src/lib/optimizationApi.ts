const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export type OptimizationStrategy = 'deterministic' | 'stochastic' | 'robust';

export interface OptimizationDemoRequest {
  strategy: OptimizationStrategy;
  demand_adjustment_pct: number;
  capacity_adjustment_pct: number;
  raw_price_adjustment_pct: number;
  shortage_penalty_multiplier: number;
  service_target_pct: number;
}

export interface StrategyComparison {
  mode: OptimizationStrategy;
  status: string;
  expected_total_cost: number;
  worst_case_cost: number;
  expected_service_level_pct: number;
  worst_service_level_pct: number;
  expected_shortage_tons: number;
  total_overtime_tons: number;
}

export interface MonthlyPlan {
  period: string;
  base_demand_tons: number;
  planned_production_tons: number;
  raw_material_purchase_tons: number;
  ending_raw_inventory_tons: number;
  overtime_tons: number;
  capacity_utilization_pct: number;
  active_campaigns: number;
}

export interface ProductPlan {
  product: string;
  base_demand_tons: number;
  planned_production_tons: number;
  expected_ending_inventory_tons: number;
  expected_shortage_tons: number;
  safety_stock_tons: number;
}

export interface ScenarioOutcome {
  scenario: string;
  label: string;
  probability: number;
  total_cost: number;
  service_level_pct: number;
  shortage_tons: number;
  ending_inventory_tons: number;
}

export interface SelectedOptimizationPlan extends StrategyComparison {
  total_purchase_tons: number;
  cost_breakdown: Record<string, number>;
  monthly_plan: MonthlyPlan[];
  product_plan: ProductPlan[];
  scenario_outcomes: ScenarioOutcome[];
}

export interface ScenarioDefinition {
  scenario: string;
  label: string;
  probability: number;
  demand_multiplier: number;
  raw_prices: number[];
}

export interface OptimizationDemoResponse {
  prototype_status: string;
  selected_strategy: OptimizationStrategy;
  currency: string;
  unit: string;
  horizon: string[];
  input: OptimizationDemoRequest;
  strategy_comparison: StrategyComparison[];
  selected_plan: SelectedOptimizationPlan;
  scenario_definitions: ScenarioDefinition[];
  assumptions_requiring_confirmation: string[];
  constraint_summary: string[];
}

export async function runOptimizationDemo(
  request: OptimizationDemoRequest,
): Promise<OptimizationDemoResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/optimization/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Optimization API responded ${response.status}: ${detail}`);
  }
  return response.json() as Promise<OptimizationDemoResponse>;
}
