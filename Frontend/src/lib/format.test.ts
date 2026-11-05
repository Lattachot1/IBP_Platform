import { describe, expect, it } from 'vitest';

import { clamp, formatNumber, formatRounded, signed } from './format';

describe('formatNumber', () => {
  it('groups thousands and keeps decimals', () => {
    expect(formatNumber(12345.6)).toBe('12,345.6');
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatRounded', () => {
  it('rounds and groups', () => {
    expect(formatRounded(1928.6)).toBe('1,929');
  });

  it('shows missing values as a dash', () => {
    expect(formatRounded(null)).toBe('-');
    expect(formatRounded(undefined)).toBe('-');
  });
});

describe('signed', () => {
  it('adds a plus to positive deltas only', () => {
    expect(signed(1500)).toBe('+1,500');
    expect(signed(-300)).toBe('-300');
    expect(signed(0)).toBe('0');
  });

  it('supports fixed digits', () => {
    expect(signed(2.5, 1)).toBe('+2.5');
  });
});

describe('clamp', () => {
  it('rounds into the range', () => {
    expect(clamp(12.6, 7, 120)).toBe(13);
    expect(clamp(3, 7, 120)).toBe(7);
    expect(clamp(500, 7, 120)).toBe(120);
  });

  it('treats non-numbers as the lower bound', () => {
    expect(clamp(Number.NaN, 7, 120)).toBe(7);
  });
});
