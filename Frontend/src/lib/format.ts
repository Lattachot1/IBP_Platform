/** Number formatting shared by the dashboard pages (en-US grouping). */

/** 12345.6 -> "12,345.6" */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Rounded to a whole number; missing values show as "-". */
export function formatRounded(v: number | null | undefined): string {
  return v === null || v === undefined ? '-' : Math.round(v).toLocaleString('en-US');
}

/** Explicit sign for deltas: +1,500 / -300 / 0 (or fixed digits: +2.5). */
export function signed(n: number, digits = 0): string {
  const v = digits ? n.toFixed(digits) : formatNumber(Math.round(n));
  return n > 0 ? `+${v}` : `${v}`;
}

/** Round to an integer and keep it inside [lo, hi]; non-numbers become lo. */
export function clamp(n: number, lo: number, hi: number): number {
  const v = Number.isFinite(n) ? Math.round(n) : lo;
  return Math.min(hi, Math.max(lo, v));
}
