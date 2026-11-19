/** Pure filtering/sorting for the product-master table, plus the per-product
 * planning figures its columns are built from. No React and no hooks here —
 * ProductMaster owns the control state and passes it in; tests hit this
 * module directly. */

import type { Forecast, Product, QcLot, SalesOrder, StockSnapshot } from './types';

/** The slice of usePlanningViews the figures need — structural, so tests can
 * pass a plain stub instead of the whole hook state. */
export interface PlanningFiguresSource {
  stock: StockSnapshot | null;
  lots: QcLot[];
  orders: SalesOrder[];
  forecasts: Forecast[];
}

/** The planning inputs of one product, summed from the imported data. */
export interface ProductFigures {
  /** imported snapshot on-hand ('—' when nothing was imported) */
  base: number | null;
  /** hand-entered stock; the plan uses it instead of the import */
  adjust: number | null;
  /** what the plan actually starts from: adjust ?? base */
  onHand: number | null;
  inQcTons: number;
  openTons: number;
  nextDue: string | null;
}

export function figuresOf(p: Product, views: PlanningFiguresSource): ProductFigures {
  const base = views.stock?.rows.find((r) => r.material_no === p.material_no)?.on_hand_tons ?? null;
  const adjust = views.stock?.adjustments.find((a) => a.material_no === p.material_no)?.adjust_tons ?? null;
  const onHand = adjust ?? base;
  const inQcTons = views.lots
    .filter((l) => l.material_no === p.material_no && l.status === 'in_qc')
    .reduce((s, l) => s + l.tons, 0);
  const open = views.orders.filter((o) => o.material_no === p.material_no && o.status === 'open');
  const openTons = open.reduce((s, o) => s + o.open_tons, 0);
  const nextDue = open.length ? open.map((o) => o.due_date).sort()[0] : null;
  return { base, adjust, onHand, inQcTons, openTons, nextDue };
}

export type ProductSortColumn =
  | 'material' | 'description' | 'group' | 'min_stock' | 'stock'
  | 'adjust' | 'in_qc' | 'open_orders' | 'status';

export interface ProductSort {
  column: ProductSortColumn;
  dir: 'asc' | 'desc';
}

/** Click cycle on a column header: asc → desc → back to the default order. */
export function nextSort(column: ProductSortColumn, current: ProductSort | null): ProductSort | null {
  if (!current || current.column !== column) return { column, dir: 'asc' };
  if (current.dir === 'asc') return { column, dir: 'desc' };
  return null;
}

export interface ProductControls {
  /** substring of the material number or description, '' = everything */
  query: string;
  /** group id, '' = every group */
  groupCode: string;
  showInactive: boolean;
  /** only products whose effective stock sits below their minimum */
  belowMinOnly: boolean;
  /** null = the default group-then-material order */
  sort: ProductSort | null;
}

const byGroupThenMaterial = (a: Product, b: Product) =>
  a.group_code.localeCompare(b.group_code) || a.material_no.localeCompare(b.material_no);

/** The column value a sort compares. null = no data (the dash cells);
 * null values always sink to the end regardless of direction. */
function sortValue(p: Product, fig: ProductFigures, column: ProductSortColumn): string | number | null {
  switch (column) {
    case 'material': return p.material_no;
    case 'description': return p.description;
    case 'group': return p.group_code;
    case 'min_stock': return p.min_stock_tons;
    case 'stock': return fig.onHand;      // effective: the adjustment wins
    case 'adjust': return fig.adjust;
    case 'in_qc': return fig.inQcTons;
    case 'open_orders': return fig.openTons;
    case 'status': return p.is_active ? 0 : 1;   // asc = active first
  }
}

/** The filtered, sorted product rows behind the Product master table. */
export function applyFilterSort(
  products: Product[],
  views: PlanningFiguresSource,
  controls: ProductControls,
): Product[] {
  const query = controls.query.trim().toLowerCase();
  const figures = new Map(products.map((p) => [p.material_no, figuresOf(p, views)]));

  const shown = products.filter((p) => {
    if (controls.groupCode && p.group_code !== controls.groupCode) return false;
    if (!controls.showInactive && !p.is_active) return false;
    if (query && !`${p.material_no} ${p.description}`.toLowerCase().includes(query)) return false;
    if (controls.belowMinOnly) {
      const onHand = figures.get(p.material_no)?.onHand ?? null;
      // a product without any stock figure is not known to be short
      if (onHand === null || onHand >= p.min_stock_tons) return false;
    }
    return true;
  });

  const sort = controls.sort;
  if (!sort) return shown.sort(byGroupThenMaterial);

  return shown.sort((a, b) => {
    const va = sortValue(a, figures.get(a.material_no)!, sort.column);
    const vb = sortValue(b, figures.get(b.material_no)!, sort.column);
    const aMissing = va === null;
    const bMissing = vb === null;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;   // dashes last, both directions
    let d = 0;
    if (!aMissing) {
      d = typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number);
      if (sort.dir === 'desc') d = -d;
    }
    return d || byGroupThenMaterial(a, b);
  });
}
