// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/lib/apiClient';

import { SAMPLE_PLAN } from '../samplePlan';
import { useOptimizePlan } from '../useOptimizePlan';
import { ProductionGantt } from './ProductionGantt';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe('product split in the Gantt', () => {
  it('shows the toggle when the plan carries per-product output and splits the blocks', async () => {
    const withProducts = {
      ...SAMPLE_PLAN, mode: 'cspat',
      days: SAMPLE_PLAN.days.map((d, i) => (i < 2
        ? { ...d, products: [{ material_no: '990101', tons: 161 }, { material_no: '990102', tons: 69 }] }
        : d)),
    };
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(withProducts), { status: 200 }));
    const { result } = renderHook(() => useOptimizePlan());
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.phase).toBe('ok'));
    render(<ProductionGantt plan={result.current} data={result.current.data!} view={result.current.view!} />);
    const toggle = screen.getByRole('checkbox', { name: /product split/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(document.querySelectorAll('.opt-prodstrip')).toHaveLength(0);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(document.querySelectorAll('.opt-prodstrip').length).toBeGreaterThan(0);
  });

  it('hides the toggle when the plan has no per-product output', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...SAMPLE_PLAN, mode: 'cspat' }), { status: 200 }));
    const { result } = renderHook(() => useOptimizePlan());
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.phase).toBe('ok'));
    render(<ProductionGantt plan={result.current} data={result.current.data!} view={result.current.view!} />);
    expect(screen.queryByRole('checkbox', { name: /product split/i })).toBeNull();
    expect(document.querySelectorAll('.opt-prodstrip')).toHaveLength(0);
  });
});
