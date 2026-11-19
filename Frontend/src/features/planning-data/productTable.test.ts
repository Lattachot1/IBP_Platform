import { describe, expect, it } from 'vitest';

import { applyFilterSort, figuresOf, nextSort } from './productTable';
import type { PlanningFiguresSource } from './productTable';
import type { Product } from './types';

const product = (material_no: string, group_code: string, overrides: Partial<Product> = {}): Product => ({
  material_no,
  description: `UBEPOL ${material_no}`,
  group_code,
  min_stock_tons: 100,
  is_active: true,
  updated_at: '2026-11-05T08:00:00Z',
  updated_by: 'sample data',
  ...overrides,
});

const views = (overrides: Partial<PlanningFiguresSource> = {}): PlanningFiguresSource => ({
  stock: { snapshot_date: '2026-11-06', loaded_at: null, loaded_by: null, rows: [], adjustments: [] },
  lots: [],
  orders: [],
  forecasts: [],
  ...overrides,
});

/** products: 990101 (BR150, active), 990104 (BR150, inactive), 990501 (VCR412) */
const products = () => [product('990501', 'VCR412'), product('990104', 'BR150', { is_active: false }), product('990101', 'BR150')];

const codes = (rows: Product[]) => rows.map((p) => p.material_no);

describe('figuresOf', () => {
  it('lets the hand-entered stock win over the imported snapshot', () => {
    const fig = figuresOf(product('990101', 'BR150'), views({
      stock: { snapshot_date: '2026-11-06', loaded_at: null, loaded_by: null,
        rows: [{ material_no: '990101', on_hand_tons: 90 }],
        adjustments: [{ material_no: '990101', adjust_tons: 150, updated_at: null, updated_by: 'planner' }] },
    }));
    expect(fig).toMatchObject({ base: 90, adjust: 150, onHand: 150 });
  });

  it('sums in-QC tons and open orders, with the earliest open due date', () => {
    const fig = figuresOf(product('990101', 'BR150'), views({
      lots: [
        { lot_no: 'L1', material_no: '990101', tons: 40, produced_date: '2026-11-01', release_date: '2026-11-06', status: 'in_qc' },
        { lot_no: 'L2', material_no: '990101', tons: 10, produced_date: '2026-10-20', release_date: '2026-10-25', status: 'released' },
        { lot_no: 'L3', material_no: '990104', tons: 99, produced_date: '2026-11-01', release_date: '2026-11-06', status: 'in_qc' },
      ],
      orders: [
        { order_no: 'SO1', item_no: 1, material_no: '990101', tons: 300, shipped_tons: 100, open_tons: 200, due_date: '2026-11-12', status: 'open', ship_to: null },
        { order_no: 'SO2', item_no: 1, material_no: '990101', tons: 100, shipped_tons: 0, open_tons: 100, due_date: '2026-11-30', status: 'open', ship_to: null },
        { order_no: 'SO3', item_no: 1, material_no: '990101', tons: 50, shipped_tons: 50, open_tons: 0, due_date: '2026-11-10', status: 'closed', ship_to: null },
      ],
    }));
    expect(fig.inQcTons).toBe(40);
    expect(fig.openTons).toBe(300);
    expect(fig.nextDue).toBe('2026-11-12');
  });
});

describe('nextSort', () => {
  it('cycles asc, desc, back to the default order', () => {
    expect(nextSort('stock', null)).toEqual({ column: 'stock', dir: 'asc' });
    expect(nextSort('stock', { column: 'stock', dir: 'asc' })).toEqual({ column: 'stock', dir: 'desc' });
    expect(nextSort('stock', { column: 'stock', dir: 'desc' })).toBeNull();
  });

  it('starts asc again when another column is clicked', () => {
    expect(nextSort('material', { column: 'stock', dir: 'desc' })).toEqual({ column: 'material', dir: 'asc' });
  });
});

describe('applyFilterSort', () => {
  it('defaults to group then material order', () => {
    expect(codes(applyFilterSort(products(), views(), {
      query: '', groupCode: '', showInactive: true, belowMinOnly: false, sort: null,
    }))).toEqual(['990101', '990104', '990501']);
  });

  it('searches the material number and the description, ignoring case', () => {
    const controls = { groupCode: '', showInactive: true, belowMinOnly: false, sort: null };
    expect(codes(applyFilterSort(products(), views(), { ...controls, query: '  9905 ' })))
      .toEqual(['990501']);
    expect(codes(applyFilterSort(products(), views(), { ...controls, query: 'ubepol 990104' })))
      .toEqual(['990104']);
    expect(codes(applyFilterSort(products(), views(), { ...controls, query: 'no such code' })))
      .toEqual([]);
  });

  it('hides inactive products and filters by group', () => {
    const controls = { query: '', belowMinOnly: false, sort: null };
    expect(codes(applyFilterSort(products(), views(), { ...controls, groupCode: 'BR150', showInactive: true })))
      .toEqual(['990101', '990104']);
    expect(codes(applyFilterSort(products(), views(), { ...controls, groupCode: 'BR150', showInactive: false })))
      .toEqual(['990101']);
  });

  it('keeps only products whose effective stock is below their minimum', () => {
    const source = views({
      stock: { snapshot_date: '2026-11-06', loaded_at: null, loaded_by: null,
        rows: [{ material_no: '990101', on_hand_tons: 90 }],
        adjustments: [{ material_no: '990501', adjust_tons: 150, updated_at: null, updated_by: 'planner' }] },
    });
    expect(codes(applyFilterSort(products(), source, {
      query: '', groupCode: '', showInactive: true, belowMinOnly: true, sort: null,
    }))).toEqual(['990101']);   // 990501's adjustment (150) clears its minimum, 990104 has no figure
  });

  it('sorts stock with the effective value and dashes always last', () => {
    const source = views({
      stock: { snapshot_date: '2026-11-06', loaded_at: null, loaded_by: null,
        rows: [{ material_no: '990101', on_hand_tons: 90 }],
        adjustments: [{ material_no: '990501', adjust_tons: 150, updated_at: null, updated_by: 'planner' }] },
    });
    const controls = { query: '', groupCode: '', showInactive: true, belowMinOnly: false };
    expect(codes(applyFilterSort(products(), source, { ...controls, sort: { column: 'stock', dir: 'asc' } })))
      .toEqual(['990101', '990501', '990104']);
    // descending flips the values but the products without figures stay at the end
    expect(codes(applyFilterSort(products(), source, { ...controls, sort: { column: 'stock', dir: 'desc' } })))
      .toEqual(['990501', '990101', '990104']);
  });

  it('sorts numbers and text, with a stable tie-break', () => {
    const controls = { query: '', groupCode: '', showInactive: true, belowMinOnly: false };
    expect(codes(applyFilterSort(products(), views(), { ...controls, sort: { column: 'material', dir: 'desc' } })))
      .toEqual(['990501', '990104', '990101']);
    // status: asc puts the active products first; ties keep the group order
    expect(codes(applyFilterSort(products(), views(), { ...controls, sort: { column: 'status', dir: 'asc' } })))
      .toEqual(['990101', '990501', '990104']);
  });
});
