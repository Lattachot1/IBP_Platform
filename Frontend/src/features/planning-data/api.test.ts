import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL, patchJson, postRaw } from '@/lib/apiClient';
import { ApiError } from '@/lib/apiError';

import { ImportRejected, importCsv, listGroups, updateProduct } from './api';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => fetchMock.mockReset());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const report = { kind: 'sales-orders', dry_run: true, rows_read: 2, records: 1, snapshot_date: null, error_count: 1,
  errors: [{ row: 3, column: 'Material Number', message: 'unknown material 123456' }], warning_count: 0, warnings: [] };

describe('apiClient raw and PATCH calls', () => {
  it('PATCHes JSON', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await patchJson('/x', { is_active: false });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{"is_active":false}');
  });

  it('POSTs a raw body with its content type', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await postRaw('/y', 'a,b\n1,2\n', 'text/csv');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe('a,b\n1,2\n');
    expect(new Headers(init.headers).get('Content-Type')).toBe('text/csv');
  });

  it('keeps the error body on ApiError', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'bad', extra: 1 }, 409));
    const err = await patchJson('/z', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toEqual({ detail: 'bad', extra: 1 });
  });
});

describe('planning data api', () => {
  it('sends the CSV as text/csv with dry_run and stock_date', async () => {
    fetchMock.mockResolvedValue(json({ ...report, error_count: 0, errors: [] }));
    await importCsv('stock', 'csv', { dryRun: true, stockDate: '2026-11-06' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/v1/imports/stock?dry_run=true&stock_date=2026-11-06`);
  });

  it('only sends stock_date for stock files and nothing for a real import', async () => {
    fetchMock.mockResolvedValue(json(report));
    await importCsv('sales-orders', 'csv', { dryRun: false, stockDate: '2026-11-06' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/v1/imports/sales-orders`);
  });

  it('turns a 422 with a report into ImportRejected', async () => {
    fetchMock.mockResolvedValue(json({ detail: '1 problem(s) in the sales-orders file - nothing was imported', report }, 422));
    const err = await importCsv('sales-orders', 'csv', { dryRun: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportRejected);
    expect((err as ImportRejected).report.errors[0].row).toBe(3);
    expect((err as ImportRejected).message).toContain('nothing was imported');
  });

  it('leaves other failures as ApiError', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'Database unavailable: sales-orders file NOT imported' }, 503));
    const err = await importCsv('sales-orders', 'csv', { dryRun: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(ImportRejected);
  });

  it('escapes the material number in the PATCH path', async () => {
    fetchMock.mockResolvedValue(json({}));
    await updateProduct('AB/7', { is_active: false });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/v1/products/AB%2F7`);
  });

  it('reads the groups from the catalog', async () => {
    fetchMock.mockResolvedValue(json({ groups: [{ id: 'BR150', disp: 'BR150', slot: 1, products: [] }], unassigned: [] }));
    await expect(listGroups()).resolves.toEqual([{ id: 'BR150', disp: 'BR150', slot: 1 }]);
  });
});
