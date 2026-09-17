/**
 * Typed API client for the butadiene forecast
 * (GET /api/v1/raw-material-price/forecast, /models, /history).
 * The forecast payload keeps the contract of the original model-service.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface RawMaterialForecastPoint {
  target_month: string;
  horizon: number;
  point: number;
  p025: number;
  p10: number;
  p50: number;
  p90: number;
  p975: number;
  best_purchase_case: number;
  base_case: number;
  worst_purchase_case: number;
}

export interface RawMaterialForecastResponse {
  artifact_version: string;
  symbol: string;
  commodity: string;
  market: string;
  unit: string;
  forecast_origin: string;
  model_name: string;
  validation_mae: number;
  validation_mae_by_horizon: Record<string, number | null> | null;
  validation_mae_holdout: number | null;
  naive_mae: number | null;
  coverage_p10_p90_holdout: number | null;
  readiness: string;
  scenario_interpretation: string;
  horizon_months: number;
  last_value: number | null;
  last_month: string | null;
  engine_source: string | null;
  forecasts: RawMaterialForecastPoint[];
}

export interface RawMaterialModelRow {
  model: string;
  champion: boolean;
  mae: number | null;
  mape: number | null;
  mae_select: number | null;
  mae_holdout: number | null;
  mae_h1: number | null;
  mae_h2: number | null;
  mae_h3: number | null;
  mae_h4: number | null;
}

export interface RawMaterialModelsResponse {
  artifact_version: string;
  forecast_origin: string;
  champion: string;
  engine_source: string | null;
  protocol: Record<string, string | number> | null;
  interval: { basis?: string; levels?: number[]; coverage_p10_p90_holdout?: number | null } | null;
  models: RawMaterialModelRow[];
}

export interface RawMaterialHistoryResponse {
  symbol: string;
  unit: string;
  last_month: string | null;
  months: { period: string; value: number }[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API ${path} responded ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchRawMaterialForecast(horizonMonths: number): Promise<RawMaterialForecastResponse> {
  return getJson<RawMaterialForecastResponse>(`/api/v1/raw-material-price/forecast?horizon_months=${horizonMonths}`);
}

export function fetchRawMaterialModels(): Promise<RawMaterialModelsResponse> {
  return getJson<RawMaterialModelsResponse>('/api/v1/raw-material-price/models');
}

export function fetchRawMaterialHistory(): Promise<RawMaterialHistoryResponse> {
  return getJson<RawMaterialHistoryResponse>('/api/v1/raw-material-price/history');
}
