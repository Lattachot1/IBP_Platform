// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BASE_FORM, buildRequest } from '../planForm';
import { GRADES } from '../samplePlan';
import type { OptimizeResult } from '../types';
import type { OptimizePlan } from '../useOptimizePlan';
import { makeScenarioDemand, usePlanningDemand } from '../usePlanningDemand';
import { DemandInputs } from './DemandInputs';
import { FulfillmentPanel } from './FulfillmentPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rows = [
  { material_no: '990101', description: 'Product A', group_code: 'BR150', is_active: true, months: [
    { month: '2026-11-01', tons: 1200, ordered_tons: 1200, group_ordered_tons: 1920, forecast_share: 0.625 },
    { month: '2026-12-01', tons: 922.88, ordered_tons: 800, group_ordered_tons: 1240, forecast_share: 0.6 },
  ] },
  { material_no: '990102', description: 'Product B', group_code: 'BR150', is_active: true, months: [
    { month: '2026-11-01', tons: 720, ordered_tons: 720, group_ordered_tons: 1920, forecast_share: 0.375 },
    { month: '2026-12-01', tons: 521.92, ordered_tons: 440, group_ordered_tons: 1240, forecast_share: 0.4 },
  ] },
];
let latest: OptimizePlan;

function Harness() {
  const [form, setForm] = useState({ ...BASE_FORM, startDate: '2026-11-09', months: 2 });
  const demand = usePlanningDemand(form, setForm);
  latest = { form, grades: GRADES, solving: false, demand } as OptimizePlan;
  return <DemandInputs plan={latest} />;
}

describe('Monthly demand inputs', () => {
  it('uses the weight of each month when converting demo demand to products', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rows))));
    const form = { ...BASE_FORM, startDate: '2026-11-09', months: 2 };
    const next = await makeScenarioDemand({
      form,
      gradeDemand: { '2026-11-01': { BR150: '2080' }, '2026-12-01': { BR150: '1340' } },
    });
    expect(buildRequest(next).monthly_product_demand).toEqual({
      '2026-11-01': { '990101': 1300, '990102': 780 },
      '2026-12-01': { '990101': 860, '990102': 480 },
    });
  });

  it('starts with actual orders and loads forecast totals at or above the floor', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(rows)));
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);
    const november = await screen.findByLabelText('Demand Product A 2026-11') as HTMLInputElement;
    const december = screen.getByLabelText('Demand Product A 2026-12') as HTMLInputElement;

    await waitFor(() => expect(november.value).toBe('1200'));
    expect(december.value).toBe('800');
    expect(buildRequest(latest.form).monthly_product_demand).toEqual({});
    expect(screen.queryByRole('radio')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load from Planning Data' }));
    await waitFor(() => expect(december.value).toBe('922.88'));
    expect(november.value).toBe('1200');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/product-demand-grid?start_month=2026-11&months=2');

    fireEvent.change(december, { target: { value: '900' } });
    expect(latest.demand.invalid).toBe(false);
    expect(buildRequest(latest.form).monthly_product_demand['2026-12-01']).toEqual({ '990101': 900, '990102': 521.92 });
    fireEvent.change(december, { target: { value: '799' } });
    expect(latest.demand.invalid).toBe(true);
    expect(december.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(december, { target: { value: '' } });
    expect(latest.demand.invalid).toBe(false);
    expect(buildRequest(latest.form).monthly_product_demand['2026-12-01']).toEqual({ '990102': 521.92 });
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(true);
  });
});

describe('FulfillmentPanel with product demand', () => {
  it('nests the product rows under their group', () => {
    const view = {
      fulfillment: [{ grade: 'BR150', disp: 'BR150', slot: 1, produced: 1145, demand: 1200, shortage: 55 }],
      product_fulfillment: [
        { material_no: '990101', description: 'UBEPOL BR150 MOCK-A', group: 'BR150', demand: 900, produced: 861, shortage: 39 },
        { material_no: '990102', description: 'UBEPOL BR150 MOCK-B', group: 'BR150', demand: 300, produced: 284, shortage: 16 },
      ],
    } as unknown as OptimizeResult;
    render(<FulfillmentPanel view={view} />);
    const rows = Array.from(document.querySelectorAll('.opt-frow')).map((r) => r.textContent);
    expect(rows).toEqual([
      'BR1501,145 / 1,200 t · short 55',
      'UBEPOL BR150 MOCK-A861 / 900 t · short 39',
      'UBEPOL BR150 MOCK-B284 / 300 t · short 16',
    ]);
    expect(screen.getByText(/shared over its products in proportion/)).toBeTruthy();
  });
});
