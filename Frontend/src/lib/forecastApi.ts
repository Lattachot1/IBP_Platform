/**
 * Typed API client for the demand-forecasting endpoints
 * (GET /api/v1/models, /api/v1/forecast, /api/v1/history).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface GradeModel {
  product_id: string;
  champion: string;
  wape: number | null;
  mase: number | null;
  wape_h1: number | null;
  wape_h2: number | null;
  wape_h3: number | null;
  months: number;
  avg_tons: number;
  trained_through: string;
  interval_level_pct: number;
  coverage_empirical: number | null;
}

export interface ModelsResponse {
  trained_at: string;
  models: GradeModel[];
}

export interface ForecastResponse {
  product_id: string;
  basis: string;
  trained_through: string;
  horizon_months: number;
  periods: string[];
  baseline_tons: number[];
  forecast_tons: number[];
  lower_tons: number[];
  upper_tons: number[];
  total_forecast_tons: number;
  demand_change_pct: number;
  model_name: string;
  interval: {
    level_pct: number;
    method: string;
    coverage_empirical: number | null;
  };
  metrics: {
    wape: number | null;
    mase: number | null;
  };
}

export interface HistoryResponse {
  product_id: string;
  trained_through: string;
  months: { period: string; tons: number }[];
  avg_tons: number;
  total_tons: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API ${path} responded ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchModels(): Promise<ModelsResponse> {
  return getJson<ModelsResponse>('/api/v1/models');
}

export function fetchForecast(productId: string, horizonMonths: number): Promise<ForecastResponse> {
  const id = encodeURIComponent(productId);
  return getJson<ForecastResponse>(`/api/v1/forecast?product_id=${id}&horizon_months=${horizonMonths}`);
}

export function fetchHistory(productId: string): Promise<HistoryResponse> {
  const id = encodeURIComponent(productId);
  return getJson<HistoryResponse>(`/api/v1/history?product_id=${id}`);
}
