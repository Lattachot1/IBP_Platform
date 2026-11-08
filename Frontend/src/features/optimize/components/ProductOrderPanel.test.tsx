// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GRADES } from '../samplePlan';
import type { OptimizeResult } from '../types';
import { ProductOrderPanel } from './ProductOrderPanel';

const view = {
  days: [
    { iso: '2026-11-09', date: '09 Nov', wd: 'Mon', wknd: false, chg: false,
      products: [{ material_no: '990101', tons: 120 }, { material_no: '990102', tons: 30 }] },
    { iso: '2026-11-10', date: '10 Nov', wd: 'Tue', wknd: false, chg: false,
      products: [{ material_no: '990101', tons: 80 }, { material_no: '990102', tons: 40 }] },
  ],
  planning: { qc_days: 5, products: [
    { material_no: '990101', group: 'BR150' },
    { material_no: '990102', group: 'BR150' },
  ] },
} as unknown as OptimizeResult;

const plan = {
  grades: GRADES,
  productNames: { '990101': 'UBEPOL BR150 MOCK-A', '990102': 'UBEPOL BR150 MOCK-B' },
} as never;

describe('ProductOrderPanel', () => {
  it('shows per-product daily tons with row totals', () => {
    render(<ProductOrderPanel plan={plan} view={view} />);
    const rowA = screen.getByText('UBEPOL BR150 MOCK-A').closest('tr');
    expect(rowA?.textContent).toContain('120');
    expect(rowA?.textContent).toContain('80');
    expect(rowA?.textContent).toContain('200');          // 120 + 80
    const rowB = screen.getByText('UBEPOL BR150 MOCK-B').closest('tr');
    expect(rowB?.textContent).toContain('30');
    expect(rowB?.textContent).toContain('70');           // 30 + 40
  });

  it('shows the all-products totals row', () => {
    render(<ProductOrderPanel plan={plan} view={view} />);
    const total = screen.getAllByText('All products')[0].closest('tr');
    expect(total?.textContent).toContain('270');         // 150 + 70 + 50 per day
  });

  it('renders nothing for a plain group-level plan', () => {
    const plain = { days: [{ iso: '2026-11-09', date: '09 Nov', wd: 'Mon', wknd: false, chg: false }] } as unknown as OptimizeResult;
    const { container } = render(<ProductOrderPanel plan={plan} view={plain} />);
    expect(container.textContent).toBe('');
  });
});
