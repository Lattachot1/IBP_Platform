import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './apiError';
import { API_BASE_URL, TimeoutError, backendAnswered, describeFailure, getJson, postJson } from './apiClient';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  vi.useRealTimers();
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('getJson / postJson', () => {
  it('calls the backend base URL and returns the JSON body', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'healthy' }));
    await expect(getJson('/api/health')).resolves.toEqual({ status: 'healthy' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/health`);
  });

  it('posts JSON', async () => {
    fetchMock.mockResolvedValue(ok({ scenario_id: 4 }));
    await postJson('/api/scenarios/save', { base_demand: 10000 });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"base_demand":10000}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('turns a non-2xx answer into ApiError', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'nope' }), { status: 503 }));
    const err = await getJson('/api/scenarios').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(backendAnswered(err)).toBe(true);
    expect(describeFailure(err)).toBe('nope');
  });

  it('reports a network failure as unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await getJson('/api/health').catch((e: unknown) => e);
    expect(backendAnswered(err)).toBe(false);
    expect(describeFailure(err)).toBe(`cannot reach the backend at ${API_BASE_URL}`);
  });

  it('aborts after the time budget with a TimeoutError', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = getJson('/api/v1/optimize', { timeoutMs: 5000 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const err = await pending;
    expect(err).toBeInstanceOf(TimeoutError);
    expect(describeFailure(err)).toBe('the backend did not answer within 5 s');
    expect(backendAnswered(err)).toBe(false);
  });
});
