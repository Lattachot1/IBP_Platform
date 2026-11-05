import { describe, expect, it } from 'vitest';

import { ApiError, formatApiDetail, readJson } from './apiError';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('formatApiDetail', () => {
  it('passes an HTTPException detail through', () => {
    expect(formatApiDetail({ detail: 'Database unavailable: scenario NOT saved' }, 503)).toBe(
      'Database unavailable: scenario NOT saved',
    );
  });

  it('lists validation issues by field, without the "body" prefix', () => {
    const body = {
      detail: [
        { loc: ['body', 'scenario_name'], msg: 'String should have at most 100 characters' },
        { loc: ['body', 'base_demand'], msg: 'Input should be greater than 0' },
      ],
    };
    expect(formatApiDetail(body, 422)).toBe(
      'scenario_name: String should have at most 100 characters; base_demand: Input should be greater than 0',
    );
  });

  it('falls back to the status for bodies it does not know', () => {
    expect(formatApiDetail(null, 502)).toBe('Backend responded HTTP 502');
    expect(formatApiDetail({ error: 'x' }, 500)).toBe('Backend responded HTTP 500');
    expect(formatApiDetail({ detail: [] }, 422)).toBe('Backend responded HTTP 422');
  });
});

describe('readJson', () => {
  it('returns the body of a 2xx response', async () => {
    await expect(readJson<{ ok: boolean }>(json({ ok: true }, 200))).resolves.toEqual({ ok: true });
  });

  it('throws ApiError with the status and readable detail', async () => {
    const err = await readJson(json({ detail: 'nope' }, 503)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).message).toBe('nope');
  });

  it('copes with a non-JSON error body', async () => {
    const err = await readJson(new Response('<html>Bad Gateway</html>', { status: 502 })).catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('Backend responded HTTP 502');
  });
});
