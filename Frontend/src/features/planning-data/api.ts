/**
 * Typed client for the product master and the planning-data endpoints:
 * /api/v1/products, /api/v1/imports/*, /api/v1/{stock,qc-lots,sales-orders,forecasts}.
 */

import { getJson, patchJson, postJson, postRaw, putJson } from '@/lib/apiClient';
import { ApiError } from '@/lib/apiError';

import type {
  EngineForecastReport,
  Forecast,
  ImportKind,
  ImportReport,
  NewProduct,
  Product,
  ProductChange,
  ProductGroup,
  QcLot,
  SalesOrder,
  StockAdjustment,
  StockSnapshot,
} from './types';

/** Imports can be large; give them more time than an ordinary call. */
const IMPORT_TIMEOUT_MS = 120_000;

export const listProducts = () => getJson<Product[]>('/api/v1/products');

export const createProduct = (product: NewProduct) => postJson<Product>('/api/v1/products', product);

export const updateProduct = (materialNo: string, change: ProductChange) =>
  patchJson<Product>(`/api/v1/products/${encodeURIComponent(materialNo)}`, change);

/** The product groups of plant_config.yaml, in display order. */
export async function listGroups(): Promise<ProductGroup[]> {
  const catalog = await getJson<{ groups: ProductGroup[] }>('/api/v1/optimize/catalog');
  return catalog.groups.map(({ id, disp, slot }) => ({ id, disp, slot }));
}

/** The backend rejected a file: `report` says which lines and columns are wrong. */
export class ImportRejected extends Error {
  readonly report: ImportReport;

  constructor(message: string, report: ImportReport) {
    super(message);
    this.name = 'ImportRejected';
    this.report = report;
    Object.setPrototypeOf(this, ImportRejected.prototype);
  }
}

export interface ImportOptions {
  dryRun: boolean;
  /** stock files without a 'Stock Date' column need one (yyyy-mm-dd) */
  stockDate?: string;
  editor?: string;
}

/** Send a CSV file as it is (the backend reads UTF-8 and Thai cp874). */
export async function importCsv(kind: ImportKind, file: Blob | string, options: ImportOptions): Promise<ImportReport> {
  const params = new URLSearchParams();
  if (options.dryRun) params.set('dry_run', 'true');
  if (kind === 'stock' && options.stockDate) params.set('stock_date', options.stockDate);
  if (options.editor) params.set(kind === 'stock' ? 'loaded_by' : 'updated_by', options.editor);
  const query = params.toString();
  try {
    return await postRaw<ImportReport>(`/api/v1/imports/${kind}${query ? `?${query}` : ''}`, file, 'text/csv', {
      timeoutMs: IMPORT_TIMEOUT_MS,
    });
  } catch (err) {
    const report = err instanceof ApiError ? (err.body as { report?: ImportReport } | null)?.report : undefined;
    if (err instanceof ApiError && err.status === 422 && report) throw new ImportRejected(err.message, report);
    throw err;
  }
}

export const getStock = () => getJson<StockSnapshot>('/api/v1/stock');

/** Hand-enter one material's stock (PUT /api/v1/stock-adjustments/{material});
 * the plan uses it instead of the imported value; tons=null clears it again. */
export const setStockAdjustment = (materialNo: string, tons: number | null) =>
  putJson<StockAdjustment | null>(`/api/v1/stock-adjustments/${encodeURIComponent(materialNo)}`, { tons });
export const getQcLots = () => getJson<QcLot[]>('/api/v1/qc-lots');
export const getSalesOrders = () => getJson<SalesOrder[]>('/api/v1/sales-orders');
export const getForecasts = () => getJson<Forecast[]>('/api/v1/forecasts');

/** Write the forecast engine's monthly forecast per group as 'engine' rows. */
export const publishEngineForecast = () =>
  postJson<EngineForecastReport>('/api/v1/forecasts/from-engine', {});
