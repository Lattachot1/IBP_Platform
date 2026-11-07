// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BASE_FORM, buildRequest, type PlanForm } from '../planForm';
import { GRADES } from '../samplePlan';
import type { CatalogGroup, OptimizeResult } from '../types';
import { DemandInputs } from './DemandInputs';
import { FulfillmentPanel } from './FulfillmentPanel';

afterEach(cleanup);

const catalog: CatalogGroup[] = GRADES.map((g) => ({
  ...g,
  products: g.id === 'BR150'
    ? [{ material_no: '990101', description: 'UBEPOL BR150 MOCK-A', min_stock_tons: 300 },
       { material_no: '990102', description: 'UBEPOL BR150 MOCK-B', min_stock_tons: 100 }]
    : [],
}));

let latest: PlanForm = BASE_FORM;

/** The same state updates as useOptimizePlan, on a plain form. */
function Harness({ withCatalog = true }: { withCatalog?: boolean }) {
  const [form, setForm] = useState<PlanForm>(BASE_FORM);
  latest = form;
  return (
    <DemandInputs
      form={form}
      grades={GRADES}
      catalog={withCatalog ? catalog : null}
      updateDemand={(g, raw) => setForm((f) => ({ ...f, demand: { ...f.demand, [g]: Number(raw) } }))}
      updateProductDemand={(g, m, raw) => setForm((f) => ({
        ...f, productDemand: { ...f.productDemand, [g]: { ...(f.productDemand[g] ?? {}), [m]: raw === '' ? 0 : Number(raw) } },
      }))}
    />
  );
}

const groupInput = () => screen.getByLabelText('demand BR150') as HTMLInputElement;

describe('DemandInputs', () => {
  it('expands a group into its products and sums them', () => {
    render(<Harness />);
    expect(screen.queryByText('990101')).toBeNull();               // names only, no material codes
    expect(screen.queryByLabelText('demand UBEPOL BR150 MOCK-A')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the products of BR150' }));
    fireEvent.change(screen.getByLabelText('demand UBEPOL BR150 MOCK-A'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('demand UBEPOL BR150 MOCK-B'), { target: { value: '300' } });
    expect(groupInput().value).toBe('1200');
    expect(groupInput().readOnly).toBe(true);
    expect(screen.getByText(/BR150 = sum of its products \(1,200 t\)/)).toBeTruthy();
    expect(buildRequest(latest).product_demand).toEqual({ '990101': 900, '990102': 300 });
    expect(buildRequest(latest).demand.BR150).toBe(1200);
  });

  it('gives the group field back once the product rows are cleared', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the products of BR150' }));
    fireEvent.change(screen.getByLabelText('demand UBEPOL BR150 MOCK-A'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('demand UBEPOL BR150 MOCK-A'), { target: { value: '' } });
    expect(groupInput().readOnly).toBe(false);
    expect(groupInput().value).toBe(String(BASE_FORM.demand.BR150));
  });

  it('keeps product rows open across collapse and offers no expander without products', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /products of VCR-412/ })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Show the products of BR150' });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('demand UBEPOL BR150 MOCK-B'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide the products of BR150' }));
    expect(screen.queryByLabelText('demand UBEPOL BR150 MOCK-B')).toBeNull();
    expect(groupInput().value).toBe('50');           // still the sum while collapsed
  });

  it('works as plain group fields without a product master', () => {
    render(<Harness withCatalog={false} />);
    expect(screen.queryByRole('button', { name: /Show the products/ })).toBeNull();
    fireEvent.change(groupInput(), { target: { value: '777' } });
    expect(buildRequest(latest).demand.BR150).toBe(777);
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
