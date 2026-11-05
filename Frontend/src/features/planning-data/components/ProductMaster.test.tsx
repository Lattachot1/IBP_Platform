// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Product } from '../types';
import type { ProductMasterState } from '../usePlanningData';
import { ProductMaster } from './ProductMaster';

afterEach(cleanup);

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

function renderMaster(overrides: Partial<ProductMasterState> = {}) {
  const master: ProductMasterState = {
    products: [product('990101', 'BR150'), product('990104', 'BR150', { is_active: false }), product('990501', 'VCR412')],
    groups: [{ id: 'BR150', disp: 'BR150', slot: 1 }, { id: 'VCR412', disp: 'VCR-412', slot: 4 }],
    loading: false,
    error: null,
    busy: null,
    refresh: vi.fn(),
    save: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  render(<ProductMaster master={master} />);
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

  it('filters by group and hides inactive products', () => {
    renderMaster();
    fireEvent.change(screen.getByLabelText('Filter by group'), { target: { value: 'BR150' } });
    expect(screen.queryByText('990501')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show inactive'));
    expect(screen.queryByText('990104')).toBeNull();
    expect(screen.getByText('990101')).toBeTruthy();
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
    renderMaster({ save: vi.fn().mockResolvedValue('Database unavailable: product NOT changed') });
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
    renderMaster({ error: 'cannot reach the backend at http://localhost:8080', products: [] });
    expect(screen.getByText(/Could not load the product master: cannot reach the backend/)).toBeTruthy();
  });
});
