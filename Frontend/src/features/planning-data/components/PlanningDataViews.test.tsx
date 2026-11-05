// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/lib/apiClient';

import type { PlanningViewsState } from '../usePlanningData';
import { PlanningDataViews } from './PlanningDataViews';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function renderViews() {
  const views: PlanningViewsState = {
    stock: { snapshot_date: '2026-11-06', loaded_at: null, loaded_by: 'sample data', rows: [{ material_no: '990401', on_hand_tons: 90 }] },
    lots: [],
    orders: [],
    forecasts: [{ group_code: 'BR150', forecast_month: '2026-12-01', source: 'manual', tons: 2600, updated_by: 'Planner A' }],
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  render(<PlanningDataViews views={views} products={[{ material_no: '990401', description: 'UBEPOL BR360B MOCK-A',
    group_code: 'BR360B', min_stock_tons: 100, is_active: true, updated_at: '2026-11-05T00:00:00Z', updated_by: 'x' }]} />);
  return views;
}

describe('PlanningDataViews', () => {
  it('marks stock below its minimum', () => {
    renderViews();
    expect(screen.getByText('90').className).toContain('text-rose-600');
  });

  it('updates the forecast from the engine and reloads the tables', async () => {
    const views = renderViews();
    fireEvent.click(screen.getByRole('tab', { name: /Forecast/ }));
    expect(screen.getByText('manual (overrides engine)')).toBeTruthy();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'published', rows: 20, groups: ['BR150', 'VCR412'], first_month: '2026-11', last_month: '2027-08',
      skipped_grades: ['UBEPOL BR150GN'], inserted: 20, updated: 0 }), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: /Update from forecast engine/ }));
    const note = await screen.findByRole('status');
    expect(note.textContent).toBe('20 engine rows for BR150, VCR412 (2026-11 to 2027-08) · 20 new, 0 updated · not a plant group: UBEPOL BR150GN');
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/v1/forecasts/from-engine`);
    expect(views.refresh).toHaveBeenCalled();
  });

  it('explains when the engine is not trained', async () => {
    renderViews();
    fireEvent.click(screen.getByRole('tab', { name: /Forecast/ }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      detail: 'Forecast engine unavailable (billing data or ML libraries missing)' }), { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: /Update from forecast engine/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Forecast engine unavailable');
  });
});
