// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastGrid } from './ForecastGrid';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const cells = [
  { group_code: 'BR150', month: '2026-11-01', tons: 2000, source: 'engine', updated_by: 'forecast engine', ordered_tons: 1200 },
  { group_code: 'BR150', month: '2026-12-01', tons: null, source: null, updated_by: null, ordered_tons: 0 },
  { group_code: 'VCR412', month: '2026-11-01', tons: 500, source: 'manual', updated_by: 'Planner (Interactive)', ordered_tons: 100 },
  { group_code: 'VCR412', month: '2026-12-01', tons: 480, source: 'engine', updated_by: 'forecast engine', ordered_tons: 0 },
];

const grades = [
  { id: 'BR150', disp: 'BR150', slot: 1 },
  { id: 'VCR412', disp: 'VCR-412', slot: 4 },
];

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function renderGrid() {
  fetchMock.mockResolvedValueOnce(jsonRes(cells));
  render(<ForecastGrid startMonth="2026-11-01" months={2} grades={grades} />);
}

describe('ForecastGrid', () => {
  it('shows the effective forecast per group and month, marking hand-set cells', async () => {
    renderGrid();
    expect((await screen.findByLabelText('Forecast BR150 2026-11') as HTMLInputElement).value).toBe('2000');
    expect((screen.getByLabelText('Forecast VCR-412 2026-11') as HTMLInputElement).value).toBe('500');
    expect(screen.getByLabelText(/Clear hand-set forecast VCR-412/)).toBeTruthy();     // manual row -> revertable
    expect(screen.queryByLabelText(/Clear hand-set forecast BR150/)).toBeNull();
    expect((screen.getByLabelText('Forecast BR150 2026-12') as HTMLInputElement).value).toBe('');   // empty month stays editable
  });

  it('saves an edit as a hand-set forecast via PUT', async () => {
    renderGrid();
    const input = await screen.findByLabelText('Forecast BR150 2026-11');
    fetchMock.mockResolvedValueOnce(jsonRes({ tons: 2500, updated_by: 'Planner (Interactive)' }));
    fireEvent.change(input, { target: { value: '2500' } });
    fireEvent.blur(input);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/api/v1/forecasts/BR150/2026-11')
      && init?.method === 'PUT'
      && JSON.parse(String(init.body)).tons === 2500)).toBe(true));
    expect((screen.getByLabelText('Forecast BR150 2026-11') as HTMLInputElement).value).toBe('2500');
    expect(screen.getByLabelText(/Clear hand-set forecast BR150/)).toBeTruthy();
  });

  it('refuses a value below the month’s orders without calling the backend', async () => {
    renderGrid();
    const input = await screen.findByLabelText('Forecast BR150 2026-11');
    fireEvent.change(input, { target: { value: '1199' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/Cannot go below/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').length).toBe(0);
  });

  it('clears a hand-set cell back to the planning data value', async () => {
    renderGrid();
    await screen.findByLabelText('Forecast VCR-412 2026-11');
    fetchMock.mockResolvedValueOnce(jsonRes({ deleted: 1 }));
    // the reload: the manual row is gone and no engine row covers that month
    fetchMock.mockResolvedValueOnce(jsonRes([
      { group_code: 'VCR412', month: '2026-11-01', tons: null, source: null, updated_by: null, ordered_tons: 100 },
      cells[3],
    ]));
    fireEvent.click(screen.getByLabelText(/Clear hand-set forecast VCR-412/));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/api/v1/forecasts/VCR412/2026-11/manual') && init?.method === 'DELETE')).toBe(true));
    await waitFor(() => expect((screen.getByLabelText('Forecast VCR-412 2026-11') as HTMLInputElement).value).toBe(''));
    expect(screen.getByLabelText('Forecast VCR-412 2026-11').className).not.toContain('text-sky-700');
    expect(screen.queryByLabelText(/Clear hand-set forecast VCR-412/)).toBeNull();
  });
});
