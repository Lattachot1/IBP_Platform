import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BASE_FORM, MONTHS_MAX, MONTHS_MIN, PRESETS, buildRequest, groupDemand, groupUsesProducts,
  monthHorizonDays, monthStartIso, nextMondayIso, scaleDemand,
} from './planForm';
import { DEMAND_DEFAULT } from './samplePlan';

afterEach(() => {
  vi.useRealTimers();
});

describe('buildRequest', () => {
  it('maps every form field to the OptimizeRequest body', () => {
    expect(buildRequest({ ...BASE_FORM, startDate: '2026-11-09' })).toEqual({
      horizon_days: 84,          // Nov 9 through Jan 31 (3 calendar months)
      start_date: '2026-11-09',
      objective: 'maximize_fulfilled',
      demand: { BR150: 2600, BR150B: 1300, BR360B: 400, VCR412: 500, VCR617: 1000, BR150L: 900, BR150LGN: 0 },
      holidays: [],
      time_limit_s: 60,
      initial: { grade: 'BR150', remain_days: 2, rx12_age: 54, rx34_age: 0 },
      use_planning_data: false,
      product_demand: {},
    });
  });

  it('starts on the next Monday when the start date is blank', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T09:00:00'));
    const body = buildRequest(BASE_FORM);
    expect(body.start_date).toBe('2026-11-09');
    expect(body.horizon_days).toBe(84);
  });

  it('turns product rows into the group total and product_demand', () => {
    const form = { ...BASE_FORM, productDemand: { BR150: { '990101': 900, '990102': 300, '990103': 0 } } };
    const body = buildRequest(form);
    expect(body.demand.BR150).toBe(1200);
    expect(body.demand.VCR412).toBe(BASE_FORM.demand.VCR412);       // untouched group keeps its field
    expect(body.product_demand).toEqual({ '990101': 900, '990102': 300 });
    expect(groupUsesProducts(form, 'BR150')).toBe(true);
    expect(groupDemand(form, 'BR150')).toBe(1200);
  });

  it('falls back to the group field when every product row is empty or 0', () => {
    const form = { ...BASE_FORM, productDemand: { BR150: { '990101': 0 } } };
    expect(groupUsesProducts(form, 'BR150')).toBe(false);
    expect(buildRequest(form).demand.BR150).toBe(BASE_FORM.demand.BR150);
    expect(buildRequest(form).product_demand).toEqual({});
  });

  it('sends no product demand when planning from the planning data', () => {
    const form = { ...BASE_FORM, usePlanningData: true, productDemand: { BR150: { '990101': 900 } } };
    expect(buildRequest(form).product_demand).toEqual({});
  });

  it('asks for the product-level plan when planning data is switched on', () => {
    expect(buildRequest({ ...BASE_FORM, usePlanningData: true }).use_planning_data).toBe(true);
  });

  it('clamps to the ranges the backend accepts (no 422 from the page)', () => {
    const body = buildRequest({
      ...BASE_FORM,
      months: 99,
      startDate: '2026-11-09',
      timeLimitS: 1,
      remainDays: -3,
      rx12Age: 900,
      rx34Age: Number.NaN,
    });
    expect(body.horizon_days).toBe(monthHorizonDays('2026-11-09', MONTHS_MAX));
    expect(body.time_limit_s).toBe(5);
    expect(body.initial).toEqual({ grade: 'BR150', remain_days: 0, rx12_age: 365, rx34_age: 0 });
  });

  it('keeps one month when MONTHS_MIN is requested, however short it is', () => {
    const body = buildRequest({ ...BASE_FORM, months: MONTHS_MIN, startDate: '2026-11-09' });
    expect(body.horizon_days).toBe(monthHorizonDays('2026-11-09', 1));
    expect(body.horizon_days).toBeGreaterThanOrEqual(7);
  });

  it('drops blank holiday rows and sends 0 for invalid demand', () => {
    const body = buildRequest({
      ...BASE_FORM,
      holidays: ['2026-12-05', '', '2026-12-10'],
      demand: { ...DEMAND_DEFAULT, BR150: -10, VCR412: Number.NaN },
    });
    expect(body.holidays).toEqual(['2026-12-05', '2026-12-10']);
    expect(body.demand.BR150).toBe(0);
    expect(body.demand.VCR412).toBe(0);
  });

  it('keeps the key order stable (the page compares requests as JSON strings)', () => {
    const a = JSON.stringify(buildRequest({ ...BASE_FORM, demand: { BR150L: 900, ...DEMAND_DEFAULT } }));
    const b = JSON.stringify(buildRequest(BASE_FORM));
    expect(a).toBe(b);
  });
});

describe('monthHorizonDays / monthStartIso', () => {
  it.each([
    ['mid-month start counts only the days left of the first month', '2026-11-23', 3, 70],   // through 2027-01-31
    ['a month boundary is exact', '2026-12-01', 2, 62],                                      // Dec + Jan
    ['leap February is 29 days', '2028-01-05', 2, 56],                                       // through 2028-02-29
  ])('%s', (_, start, months, expected) => {
    expect(monthHorizonDays(start, months)).toBe(expected);
  });

  it('shifts months across the year boundary', () => {
    expect(monthStartIso('2026-11-23', 3)).toBe('2027-02-01');
    expect(monthStartIso('2026-11-23', 0)).toBe('2026-11-01');
  });
});

describe('nextMondayIso', () => {
  it.each([
    ['a Monday never starts the plan today', '2026-11-02T09:00:00', '2026-11-09'],
    ['a Sunday starts tomorrow', '2026-11-08T09:00:00', '2026-11-09'],
    ['a Saturday starts in two days', '2026-11-07T23:30:00', '2026-11-09'],
  ])('%s', (_, now, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    expect(nextMondayIso()).toBe(expected);
  });
});

describe('scaleDemand', () => {
  it('scales and rounds every grade', () => {
    expect(scaleDemand({ BR150: 2600, BR360B: 401 }, 1.2)).toEqual({ BR150: 3120, BR360B: 481 });
  });
});

describe('PRESETS', () => {
  const current = { ...BASE_FORM, startDate: '2026-11-09', holidays: ['2026-12-05'], months: 2, rx12Age: 10 };

  it('reset the plan inputs but keep the calendar', () => {
    PRESETS.forEach((p) => {
      const next = p.apply(current);
      expect(next.startDate).toBe('2026-11-09');
      expect(next.holidays).toEqual(['2026-12-05']);
      expect(next.months).toBe(BASE_FORM.months);
    });
  });

  it('set their own demand or plant state', () => {
    const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p.apply(current)]));
    expect(byId.surge.demand.BR150).toBe(3120);
    expect(byId.vcr.demand).toMatchObject({ VCR412: 1500, VCR617: 2000 });
    expect(byId.clean.rx12Age).toBe(58);
    expect(byId.base.demand).toEqual(DEMAND_DEFAULT);
  });
});
