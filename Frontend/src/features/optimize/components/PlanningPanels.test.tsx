// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/lib/apiClient';

import { GRADES, SAMPLE_PLAN } from '../samplePlan';
import type { PlanDay, PlanningSection } from '../types';
import { productLines, useOptimizePlan } from '../useOptimizePlan';
import { ForecastPanel, OrderStatusPanel, PlanningKpiStrip, StockProjectionPanel } from './PlanningPanels';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const planning: PlanningSection = {
  snapshot_date: '2026-11-06',
  qc_days: 5,
  kpis: {
    orders_in_horizon: 3, orders_on_time: 1, orders_late: 1, orders_not_covered: 1,
    on_time_pct: 33.3, on_time_tons_pct: 40, late_ton_days: 160, below_min_ton_days: 700, forecast_short_tons: 119,
  },
  products: [{
    material_no: '990401', description: 'UBEPOL BR360B MOCK-A', group: 'BR360B', min_stock: 100, start_stock: 90,
    qc_release: [0, 0, 0], shipped: [0, 80, 0], produced: [0, 230, 0], stock: [90, 10, 240], end_stock: 240,
    days_below_min: 2, share: 1, lookahead_tons: 150,
  }],
  orders: [
    { order_no: '9100000001', item_no: 10, material_no: '990401', open_tons: 40, due_date: '2026-11-10',
      ready_date: '2026-11-10', late_days: 0, status: 'on_time', in_horizon: true },
    { order_no: '9100000002', item_no: 10, material_no: '990401', open_tons: 80, due_date: '2026-11-11',
      ready_date: '2026-11-13', late_days: 2, status: 'late', in_horizon: true },
    { order_no: '9100000003', item_no: 20, material_no: '990401', open_tons: 60, due_date: '2026-11-12',
      ready_date: null, late_days: null, status: 'not_covered', in_horizon: true },
    { order_no: '9100000004', item_no: 10, material_no: '990401', open_tons: 60, due_date: '2027-01-12',
      ready_date: null, late_days: null, status: 'after_horizon', in_horizon: false },
  ],
  forecast: [{
    group: 'BR360B', month: '2026-12', source: 'manual', forecast: 450, ordered: 260, not_yet_ordered: 190,
    share_in_horizon: 0.194, to_produce: 36.8, deadline: '2026-12-06', short_tons: 119,
  }],
  warnings: [],
};

describe('planning panels', () => {
  it('shows the order KPIs', () => {
    render(<PlanningKpiStrip planning={planning} />);
    expect(screen.getByText('Orders on time').parentElement?.textContent).toContain('1 / 3');
    expect(screen.getByText(/1 late · 1 not covered/)).toBeTruthy();
    expect(screen.getByText('2026-11-06')).toBeTruthy();
  });

  it('opens on the orders that are not on time and can show the rest', () => {
    render(<OrderStatusPanel planning={planning} />);
    const rows = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(rows()).toEqual(['9100000002/10', '9100000003/20']);
    expect(screen.getByText('Not covered')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /All due in the horizon/ }));
    expect(rows()).toEqual(['9100000001/10', '9100000002/10', '9100000003/20']);
    fireEvent.click(screen.getByRole('tab', { name: /Due after the horizon/ }));
    expect(rows()).toEqual(['9100000004/10']);
  });

  it('says so when every order is on time', () => {
    const allGood = { ...planning, orders: [planning.orders[0]] };
    render(<OrderStatusPanel planning={allGood} />);
    expect(screen.getByRole('tab', { name: /All due in the horizon/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Not on time/ }));
    expect(screen.getByText('Every order due in the horizon ships on time')).toBeTruthy();
  });

  it('draws projected stock against the minimum', () => {
    render(<StockProjectionPanel planning={planning} grades={GRADES} />);
    expect(screen.getByRole('img', { name: '990401 stock from 90 to 240 t' })).toBeTruthy();
    const row = screen.getByText('990401').closest('tr') as HTMLElement;
    expect(row.textContent).toContain('UBEPOL BR360B MOCK-A · BR360B');
    expect(row.textContent).toContain('230');     // produced
  });

  it('lists the forecast still to produce', () => {
    render(<ForecastPanel planning={planning} grades={GRADES} />);
    const row = screen.getByText('2026-12 · manual').closest('tr') as HTMLElement;
    expect(row.textContent).toContain('190');
    expect(row.textContent).toContain('(19%)');
    expect(within(row).getByText('119').className).toContain('opt-short');
  });

  it('points to the planning data page when there is no forecast', () => {
    render(<ForecastPanel planning={{ ...planning, forecast: [] }} grades={GRADES} />);
    expect(screen.getByRole('link', { name: 'Planning Data' }).getAttribute('href')).toBe('/planning-data');
  });
});

describe('product lines in the Gantt tooltip', () => {
  const day = { ...SAMPLE_PLAN.days[0], iso: '2026-11-28', products: [
    { material_no: '990101', tons: 161 }, { material_no: '990102', tons: 69 }] } as PlanDay;

  it('lists each product and the day it clears QC', () => {
    expect(productLines(day, 5)).toEqual(['  · 990101: 161 t', '  · 990102: 69 t', 'In stock after QC: 2026-12-03']);
  });

  it('adds nothing for a day without products', () => {
    expect(productLines({ ...day, products: [] }, 5)).toEqual([]);
  });
});

describe('useOptimizePlan with planning data', () => {
  it('sends use_planning_data and blocks hand edits on the result', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe(`${API_BASE_URL}/api/v1/optimize`);
      const body = JSON.parse(String(init.body));
      const result = body.use_planning_data ? { ...SAMPLE_PLAN, mode: 'cspat', planning } : { ...SAMPLE_PLAN, mode: 'cspat' };
      return new Response(JSON.stringify(result), { status: 200 });
    });
    const { result } = renderHook(() => useOptimizePlan());
    await waitFor(() => expect(result.current.phase).toBe('ok'));
    expect(result.current.canEdit).toBe(true);

    act(() => result.current.patch({ usePlanningData: true }));
    expect(result.current.unapplied).toBe(true);
    await act(() => result.current.run());
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1].body)).use_planning_data).toBe(true);
    expect(result.current.data?.planning?.kpis.orders_late).toBe(1);
    expect(result.current.canEdit).toBe(false);
    expect(result.current.editBlockedReason).toMatch(/planning data/);
  });
});
