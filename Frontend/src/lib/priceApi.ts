/**
 * Typed API client for the sale-price forecast and revenue outlook endpoints
 * (GET /api/v1/price/models, /price/history, /price/forecast, /revenue/outlook).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/** flat = hold BD at its last value shifted by a percentage; low/base/high = P10/P50/P90 path of the butadiene forecast */
export type BdScenario = 'flat' | 'low' | 'base' | 'high';

export interface PriceModelRow {
  product_id: string;
  champion: string;
  mape: number | null;
  mape_holdout: number | null;
  naive_mape: number | null;
  naive_mape_holdout: number | null;
  mape_h1: number | null;
  mape_h2: number | null;
  mape_h3: number | null;
  months: number;
  avg_price: number | null;
  last_price: number | null;
  bd_last: number | null;
  trained_through: string;
  interval_level_pct: number;
  coverage_empirical: number | null;
  folds: number;
  holdout_folds: number | null;
}

export interface PriceModelsResponse {
  trained_at: string;
  artifact_version: string | null;
  target: string | null;
  bd_symbol: string | null;
  bd_last_month: string | null;
  bd_last: number | null;
  protocol: Record<string, string | number> | null;
  models: PriceModelRow[];
}

export interface PriceHistoryMonth {
  period: string;
  fob_price: number | null;
  net_price: number | null;
  qty: number | null;
  bd: number | null;
}

export interface PriceHistoryResponse {
  product_id: string;
  trained_through: string;
  months: PriceHistoryMonth[];
  avg_price: number;
  last_price: number;
}

export interface PriceForecastResponse {
  product_id: string;
  basis: string | null;
  trained_through: string;
  horizon_months: number;
  bd_change_pct: number;
  bd_scenario: BdScenario;
  bd_source: string;
  bd_last: number;
  bd_last_month: string | null;
  periods: string[];
  bd_path: number[];
  forecast: number[];
  lower: number[];
  upper: number[];
  naive: number[];
  passthrough: number[];
  model_name: string;
  interval: {
    level_pct: number;
    coverage_empirical: number | null;
    method: string;
  };
  metrics: {
    mape: number | null;
    mape_holdout: number | null;
    naive_mape: number | null;
    mape_h: Record<string, number | null> | null;
  };
  note: string;
}

export interface RevenueMonth {
  period: string;
  tons: number;
  price_usd_t: number;
  revenue_usd: number;
}

export interface RevenueGrade {
  product_id: string;
  months: RevenueMonth[];
  total_tons: number;
  total_revenue_usd: number;
  price_model: string;
  demand_model: string;
}

export interface RevenueOutlookResponse {
  horizon_months: number;
  bd_change_pct: number;
  demand_change_pct: number;
  bd_scenario: BdScenario;
  bd_source: string;
  basis: string;
  periods: string[];
  grades: RevenueGrade[];
  totals: { period: string; tons: number; revenue_usd: number }[];
  grand_total_tons: number;
  grand_total_revenue_usd: number;
  skipped: string[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API ${path} responded ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchPriceModels(): Promise<PriceModelsResponse> {
  return getJson<PriceModelsResponse>('/api/v1/price/models');
}

export function fetchPriceHistory(productId: string): Promise<PriceHistoryResponse> {
  const id = encodeURIComponent(productId);
  return getJson<PriceHistoryResponse>(`/api/v1/price/history?product_id=${id}`);
}

export function fetchPriceForecast(
  productId: string,
  horizonMonths: number,
  bdChangePct: number,
  bdScenario: BdScenario = 'flat'
): Promise<PriceForecastResponse> {
  const id = encodeURIComponent(productId);
  return getJson<PriceForecastResponse>(
    `/api/v1/price/forecast?product_id=${id}&horizon_months=${horizonMonths}&bd_change_pct=${bdChangePct}&bd_scenario=${bdScenario}`
  );
}

export function fetchRevenueOutlook(
  horizonMonths: number,
  bdChangePct: number,
  demandChangePct: number,
  bdScenario: BdScenario = 'flat'
): Promise<RevenueOutlookResponse> {
  return getJson<RevenueOutlookResponse>(
    `/api/v1/revenue/outlook?horizon_months=${horizonMonths}&bd_change_pct=${bdChangePct}&demand_change_pct=${demandChangePct}&bd_scenario=${bdScenario}`
  );
}
