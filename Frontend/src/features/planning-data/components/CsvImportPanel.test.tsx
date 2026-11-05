// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImportKind } from '../types';
import { useCsvImport } from '../usePlanningData';
import { CsvImportPanel } from './CsvImportPanel';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const base = { kind: 'sales-orders', rows_read: 166, records: 166, snapshot_date: null,
  error_count: 0, errors: [], warning_count: 0, warnings: [] };

function Harness({ onImported }: { onImported: (kind: ImportKind) => void }) {
  const imp = useCsvImport(onImported);
  return <CsvImportPanel imp={imp} />;
}

function setup() {
  const onImported = vi.fn();
  render(<Harness onImported={onImported} />);
  const file = new File(['Sales Order Number\n'], 'orders.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });
  return { onImported };
}

const importButton = () => screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;

describe('CsvImportPanel', () => {
  it('imports only after a successful check of the same file', async () => {
    const { onImported } = setup();
    expect(importButton().disabled).toBe(true);

    fetchMock.mockResolvedValueOnce(json({ ...base, dry_run: true, inserted: 120, updated: 46 }));
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    await screen.findByText(/File is valid/);
    expect(screen.getByText(/120 new · 46 updated/)).toBeTruthy();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/imports/sales-orders?dry_run=true');
    expect(importButton().disabled).toBe(false);

    fetchMock.mockResolvedValueOnce(json({ ...base, dry_run: false, inserted: 120, updated: 46 }));
    fireEvent.click(importButton());
    await screen.findByText('Imported');
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('dry_run');
    expect(onImported).toHaveBeenCalledWith('sales-orders');
  });

  it('lists the rejected lines and keeps Import disabled', async () => {
    setup();
    fetchMock.mockResolvedValueOnce(json({
      detail: '1 problem(s) in the sales-orders file - nothing was imported',
      report: { ...base, dry_run: true, error_count: 1,
        errors: [{ row: 7, column: 'Delivered Qty', message: 'delivered 50 t must be between 0 and the ordered 40 t' }] },
    }, 422));
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    await screen.findByText(/nothing was imported/);
    expect(screen.getByText('Delivered Qty')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(importButton().disabled).toBe(true);
  });

  it('a new file or type needs a new check', async () => {
    setup();
    fetchMock.mockResolvedValueOnce(json({ ...base, dry_run: true, inserted: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    await waitFor(() => expect(importButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('radio', { name: /Stock/ }));
    expect(importButton().disabled).toBe(true);
    expect(screen.getByLabelText('Stock date')).toBeTruthy();
  });

  it('reports an unreachable backend', async () => {
    setup();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    await screen.findByText(/Could not reach the import: cannot reach the backend/);
  });
});
