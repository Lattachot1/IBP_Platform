/** Shapes of the product master and planning-data endpoints (Backend/api/products.py, planning.py). */

export interface Product {
  material_no: string;
  description: string;
  group_code: string;
  min_stock_tons: number;
  is_active: boolean;
  updated_at: string;
  updated_by: string;
}

export interface NewProduct {
  material_no: string;
  description: string;
  group_code: string;
  min_stock_tons: number;
  updated_by?: string;
}

/** PATCH body: only the fields that change. */
export type ProductChange = Partial<Pick<Product, 'description' | 'group_code' | 'min_stock_tons' | 'is_active'>> & {
  updated_by?: string;
};

export interface ProductGroup {
  id: string;
  disp: string;
  slot: number;
}

export type ImportKind = 'stock' | 'qc-lots' | 'sales-orders' | 'forecasts';

export interface ImportProblem {
  row: number | null;
  column: string | null;
  message: string;
}

export interface ImportReport {
  kind: ImportKind;
  dry_run: boolean;
  rows_read: number;
  records: number;
  snapshot_date: string | null;
  error_count: number;
  errors: ImportProblem[];
  warning_count: number;
  warnings: ImportProblem[];
  /** present when the file was accepted */
  inserted?: number;
  updated?: number;
  replaced?: number;
}

export interface StockRow {
  material_no: string;
  on_hand_tons: number;
}

export interface StockSnapshot {
  snapshot_date: string | null;
  loaded_at: string | null;
  loaded_by: string | null;
  rows: StockRow[];
}

export interface QcLot {
  lot_no: string;
  material_no: string;
  tons: number;
  produced_date: string;
  release_date: string;
  status: 'in_qc' | 'released' | 'rejected';
}

export interface SalesOrder {
  order_no: string;
  item_no: number;
  material_no: string;
  tons: number;
  shipped_tons: number;
  open_tons: number;
  due_date: string;
  status: 'open' | 'closed' | 'cancelled';
}

/** POST /api/v1/forecasts/from-engine */
export interface EngineForecastReport {
  status: 'published' | 'checked';
  rows: number;
  groups: string[];
  first_month: string | null;
  last_month: string | null;
  skipped_grades: string[];
  inserted: number;
  updated: number;
}

export interface Forecast {
  group_code: string;
  forecast_month: string;
  source: 'engine' | 'manual';
  tons: number;
  updated_by: string | null;
}
