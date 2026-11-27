import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BASE_FORM, MONTHS_MAX, MONTHS_MIN, PRESETS, buildRequest, demandError,
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
      holidays: [],
      time_limit_s: 60,
      initial: { grade: 'BR150', remain_days: 2, rx12_age: 54, rx34_age: 0 },
      use_planning_data: true,
      monthly_product_demand: {},
    });
  });

  it('starts on the next Monday when the start date is blank', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T09:00:00'));
    const body = buildRequest(BASE_FORM);
    expect(body.start_date).toBe('2026-11-09');
    expect(body.horizon_days).toBe(84);
  });

  it('sends only explicit demand totals for the selected months', () => {
    const body = buildRequest({
      ...BASE_FORM,
      months: 2,
      startDate: '2026-11-09',
      monthlyDemand: {
        '2026-11-01': { '400003-ST,WS': '1920.4', '990102': '' },
        '2026-12-01': { '990401': '0' },
        '2027-01-01': { '400003-ST,WS': '2500' },
      },
    });
    expect(body.monthly_product_demand).toEqual({
      '2026-11-01': { '400003-ST,WS': 1920.4 },
      '2026-12-01': { '990401': 0 },
    });
  });

  it('accepts a blank as the order total and rejects values below the floor', () => {
    expect(demandError('', 120)).toBeNull();
    expect(demandError('120', 120)).toBeNull();
    expect(demandError('119.99', 120)).toContain('below actual orders');
    expect(demandError('Infinity', 0)).toContain('non-negative');
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

  it('drops blank holiday rows', () => {
    const body = buildRequest({
      ...BASE_FORM,
      holidays: ['2026-12-05', '', '2026-12-10'],
    });
    expect(body.holidays).toEqual(['2026-12-05', '2026-12-10']);
  });

  it('keeps the key order stable (the page compares requests as JSON strings)', () => {
    const month = '2026-11-01';
    const form = { ...BASE_FORM, startDate: month };
    const a = JSON.stringify(buildRequest({ ...form, monthlyDemand: { [month]: { '990601': '900', '400003-ST,WS': '500' } } }));
    const b = JSON.stringify(buildRequest({ ...form, monthlyDemand: { [month]: { '400003-ST,WS': '500', '990601': '900' } } }));
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
      const { form: next } = p.apply(current);
      expect(next.startDate).toBe('2026-11-09');
      expect(next.holidays).toEqual(['2026-12-05']);
      expect(next.months).toBe(BASE_FORM.months);
    });
  });

  it('set their own demand or plant state', () => {
    const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p.apply(current)]));
    const total = (scenario: ReturnType<typeof PRESETS[number]["apply"]>, grade: string) => Object.values(scenario.gradeDemand)
      .reduce((sum, month) => sum + Number(month[grade]), 0);
    expect(total(byId.surge, 'BR150')).toBe(3120);
    expect(total(byId.vcr, 'VCR412')).toBe(1500);
    expect(total(byId.vcr, 'VCR617')).toBe(2000);
    expect(byId.clean.form.rx12Age).toBe(58);
    expect(total(byId.base, 'BR150')).toBe(DEMAND_DEFAULT.BR150);
  });
});
