// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/lib/apiClient';

import type { Product } from '../types';
import type { PlanningViewsState, ProductMasterState } from '../usePlanningData';
import { ProductMaster } from './ProductMaster';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

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

const views = (overrides: Partial<PlanningViewsState> = {}): PlanningViewsState => ({
  stock: { snapshot_date: '2026-11-06', loaded_at: null, loaded_by: 'sample data', rows: [{ material_no: '990101', on_hand_tons: 90 }] },
  lots: [{ lot_no: 'L1', material_no: '990101', tons: 40, produced_date: '2026-11-01', release_date: '2026-11-06', status: 'in_qc' }],
  orders: [{ order_no: 'SO1', item_no: 1, material_no: '990101', tons: 300, shipped_tons: 100, open_tons: 200, due_date: '2026-11-12', status: 'open' }],
  forecasts: [{ group_code: 'BR150', forecast_month: '2026-12-01', source: 'manual', tons: 2600, updated_by: 'Planner A' }],
  loading: false,
  error: null,
  refresh: vi.fn().mockResolvedValue(undefined),
  editStock: vi.fn().mockResolvedValue(null),
  ...overrides,
});

function renderMaster(viewOverrides: Partial<PlanningViewsState> = {}, masterOverrides: Partial<ProductMasterState> = {}) {
  const master: ProductMasterState = {
    products: [product('990101', 'BR150'), product('990104', 'BR150', { is_active: false }), product('990501', 'VCR412')],
    groups: [{ id: 'BR150', disp: 'BR150', slot: 1 }, { id: 'VCR412', disp: 'VCR-412', slot: 4 }],
    loading: false,
    error: null,
    busy: null,
    refresh: vi.fn(),
    save: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockResolvedValue(null),
    ...masterOverrides,
  };
  render(<ProductMaster master={master} views={views(viewOverrides)} />);
  return master;
}

const row = (material: string) => screen.getByText(material).closest('tr') as HTMLElement;

describe('ProductMaster', () => {
  it('lists products with their group name and status', () => {
    renderMaster();
    expect(screen.getByText(/2 active of 3 products/)).toBeTruthy();
    expect(within(row('990501')).getByText('VCR-412')).toBeTruthy();
    expect(within(row('990104')).getByText('Inactive')).toBeTruthy();
  });

  it('summarises the planning data in the card subtitle', () => {
    renderMaster();
    expect(screen.getByText(/Stock is the snapshot of 2026-11-06/)).toBeTruthy();
    expect(screen.getByText(/1 lots in QC · 1 open orders/)).toBeTruthy();
  });

  it('filters by group and hides inactive products', () => {
    renderMaster();
    fireEvent.change(screen.getByLabelText('Filter by group'), { target: { value: 'BR150' } });
    expect(screen.queryByText('990501')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show inactive'));
    expect(screen.queryByText('990104')).toBeNull();
    expect(screen.getByText('990101')).toBeTruthy();
  });

  it('shows on hand next to minimum stock and marks a shortage', () => {
    renderMaster();
    expect(within(row('990101')).getByText('90').className).toContain('text-rose-600');
    expect(within(row('990101')).getByText('100')).toBeTruthy();
  });

  it('hand-edits the on-hand stock and saves on Enter', async () => {
    const editStock = vi.fn().mockResolvedValue(null);
    renderMaster({ editStock });
    fireEvent.click(within(row('990101')).getByText('90'));
    const input = screen.getByLabelText('On-hand stock of 990101') as HTMLInputElement;
    expect(input.value).toBe('90');
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(editStock).toHaveBeenCalledWith('990101', 120));
  });

  it('keeps the editor open with the error for invalid tons and Escape cancels', async () => {
    const editStock = vi.fn();
    renderMaster({ editStock });
    fireEvent.click(within(row('990101')).getByText('90'));
    const input = screen.getByLabelText('On-hand stock of 990101');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('0 or more');
    expect(editStock).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('On-hand stock of 990101')).toBeNull();
  });

  it('is not editable without a stock snapshot', () => {
    renderMaster({ stock: { snapshot_date: null, loaded_at: null, loaded_by: null,
      rows: [{ material_no: '990101', on_hand_tons: 90 }] } });
    fireEvent.click(within(row('990101')).getByText('90'));
    expect(screen.queryByLabelText('On-hand stock of 990101')).toBeNull();
  });

  it('shows a dash for products without planning data', () => {
    renderMaster({ stock: { snapshot_date: null, loaded_at: null, loaded_by: null, rows: [] }, lots: [], orders: [] });
    expect(within(row('990501')).getAllByText('—').length).toBe(3);
  });

  it('sums open orders with the earliest due date', () => {
    renderMaster({ orders: [
      { order_no: 'SO1', item_no: 1, material_no: '990101', tons: 300, shipped_tons: 100, open_tons: 200, due_date: '2026-11-12', status: 'open' },
      { order_no: 'SO2', item_no: 1, material_no: '990101', tons: 100, shipped_tons: 0, open_tons: 100, due_date: '2026-11-30', status: 'open' },
      { order_no: 'SO3', item_no: 1, material_no: '990101', tons: 50, shipped_tons: 50, open_tons: 0, due_date: '2026-11-10', status: 'closed' },
    ] });
    expect(within(row('990101')).getByText('300')).toBeTruthy();
    expect(within(row('990101')).getByText(/next due 2026-11-12/)).toBeTruthy();
  });

  it('expands a row into its QC lots, sales orders and group forecast', () => {
    renderMaster();
    expect(screen.queryByText('L1')).toBeNull();
    fireEvent.click(within(row('990101')).getByRole('button', { name: 'Details of 990101' }));
    expect(screen.getByText('L1')).toBeTruthy();
    expect(screen.getByText('SO1/1')).toBeTruthy();
    expect(screen.getByText(/Group forecast — BR150/)).toBeTruthy();
    expect(screen.getByText('manual (overrides engine)')).toBeTruthy();
    expect(screen.getByText(/Last change: sample data/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Details of 990101' }));
    expect(screen.queryByText('L1')).toBeNull();
  });

  it('deactivates and reactivates instead of deleting', () => {
    const master = renderMaster();
    fireEvent.click(within(row('990101')).getByRole('button', { name: 'Deactivate' }));
    expect(master.save).toHaveBeenCalledWith('990101', { is_active: false });
    fireEvent.click(within(row('990104')).getByRole('button', { name: 'Reactivate' }));
    expect(master.save).toHaveBeenCalledWith('990104', { is_active: true });
  });

  it('saves only the fields that changed', async () => {
    const master = renderMaster();
    fireEvent.click(within(row('990101')).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Minimum stock of 990101'), { target: { value: '250.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(master.save).toHaveBeenCalledWith('990101', { min_stock_tons: 250.5 }));
  });

  it('rejects a bad minimum before calling the backend', () => {
    const master = renderMaster();
    fireEvent.click(within(row('990101')).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Minimum stock of 990101'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toContain('0 or more');
    expect(master.save).not.toHaveBeenCalled();
  });

  it('shows the backend error of a failed save on the row', async () => {
    renderMaster({}, { save: vi.fn().mockResolvedValue('Database unavailable: product NOT changed') });
    fireEvent.click(within(row('990101')).getByRole('button', { name: 'Deactivate' }));
    expect((await screen.findByRole('alert')).textContent).toContain('NOT changed');
  });

  it('adds a product', async () => {
    const master = renderMaster();
    fireEvent.click(screen.getByRole('button', { name: /Add product/ }));
    fireEvent.change(screen.getByLabelText('Material number'), { target: { value: '990777' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'UBEPOL NEW' } });
    fireEvent.change(screen.getByLabelText('New product group'), { target: { value: 'VCR412' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add product' }).at(-1) as HTMLElement);
    await waitFor(() => expect(master.add).toHaveBeenCalledWith({
      material_no: '990777', description: 'UBEPOL NEW', group_code: 'VCR412', min_stock_tons: 0 }));
  });

  it('shows a load error instead of rows', () => {
    renderMaster({}, { error: 'cannot reach the backend at http://localhost:8080', products: [] });
    expect(screen.getByText(/Could not load the product master: cannot reach the backend/)).toBeTruthy();
  });

  it('updates the forecast from the engine and reloads the table', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'published', rows: 20, groups: ['BR150', 'VCR412'], first_month: '2026-11', last_month: '2027-08',
      skipped_grades: ['UBEPOL BR150GN'], inserted: 20, updated: 0 }), { status: 200 }));
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderMaster({ refresh });
    fireEvent.click(screen.getByRole('button', { name: /Update from forecast engine/ }));
    const note = await screen.findByRole('status');
    expect(note.textContent).toBe('20 engine rows for BR150, VCR412 (2026-11 to 2027-08) · 20 new, 0 updated · not a plant group: UBEPOL BR150GN');
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/v1/forecasts/from-engine`);
    expect(refresh).toHaveBeenCalled();
  });

  it('explains when the engine is not trained', async () => {
    renderMaster();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      detail: 'Forecast engine unavailable (billing data or ML libraries missing)' }), { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: /Update from forecast engine/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Forecast engine unavailable');
  });
});
