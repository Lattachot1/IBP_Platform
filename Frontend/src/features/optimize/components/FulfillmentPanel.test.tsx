// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SAMPLE_PLAN } from '../samplePlan';
import type { PlanningSection } from '../types';
import { FulfillmentPanel } from './FulfillmentPanel';

afterEach(cleanup);

const planning: PlanningSection = {
  snapshot_date: '2026-11-06',
  qc_days: 5,
  kpis: {
    orders_in_horizon: 1, orders_on_time: 1, orders_late: 0, orders_not_covered: 0,
    on_time_pct: 100, on_time_tons_pct: 100, late_ton_days: 0, below_min_ton_days: 0, forecast_short_tons: 0,
  },
  products: [{
    material_no: '990401', description: 'UBEPOL BR360B MOCK-A', group: 'BR360B', min_stock: 100, start_stock: 90,
    qc_release: [0, 0, 0], shipped: [0, 80, 0], produced: [0, 230, 0], stock: [90, 10, 240], end_stock: 240,
    days_below_min: 2, share: 1, lookahead_tons: 150, requirement: 360, shortage: 130,
  }],
  orders: [],
  forecast: [],
  warnings: [],
};

describe('fulfillment per product', () => {
  it('planning mode nests each product under its group with requirement and shortage', () => {
    render(<FulfillmentPanel view={{ ...SAMPLE_PLAN, planning }} />);
    const row = screen.getByText('UBEPOL BR360B MOCK-A').closest('.opt-frow') as HTMLElement;
    expect(row.textContent).toContain('230 / 360');
    expect(row.textContent).toContain('short 130');
    expect(screen.getByText(/requirement = its orders due in the plan/)).toBeTruthy();
    expect(screen.queryByText(/shared over its products in proportion/)).toBeNull();
  });

  it('demand mode keeps the proportional note and the demand of each product', () => {
    render(<FulfillmentPanel view={{ ...SAMPLE_PLAN, product_fulfillment: [
      { material_no: '990101', description: 'UBEPOL BR150 MOCK-A', group: 'BR150', demand: 100, produced: 90, shortage: 10 },
    ] }} />);
    const row = screen.getByText('UBEPOL BR150 MOCK-A').closest('.opt-frow') as HTMLElement;
    expect(row.textContent).toContain('90 / 100');
    expect(screen.getByText(/shared over its products in proportion/)).toBeTruthy();
  });

  it('adds no note for a plan without per-product output', () => {
    render(<FulfillmentPanel view={SAMPLE_PLAN} />);
    expect(screen.queryByText(/requirement =/)).toBeNull();
    expect(screen.queryByText(/shared over its products/)).toBeNull();
  });
});
