// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/lib/apiClient';

import type { ScenarioResult } from './types';
import { useScenarioSimulator } from './useScenarioSimulator';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function scenario(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenario_id: 7,
    scenario_name: 'From backend',
    base_demand: 10000,
    demand_change_pct: 20,
    forecast_demand: 12000,
    lower_bound: 11400,
    upper_bound: 12600,
    capacity_limit: 10500,
    enable_ot: false,
    actual_produce: 10500,
    shortage_qty: 1500,
    service_level_pct: 87.5,
    revenue_thb: 10500000,
    extra_cost_thb: 0,
    constraint_status: 'Capacity Overload Bottleneck (Shortage: 1500 units)',
    model_name: 'Ensemble Baseline (ETS/ML)',
    created_by: 'Planner',
    ...overrides,
  };
}

/** A backend in in-memory mode; `simulate` decides what /api/simulate answers. */
function backend(simulate: (body: Record<string, unknown>) => Response = () => json(scenario())) {
  const saved: Record<string, unknown>[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.slice(API_BASE_URL.length);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === '/api/health') return json({ status: 'healthy', storage: 'memory' });
    if (path === '/api/scenarios') return json([scenario({ scenario_id: 1, scenario_name: 'Seed' })]);
    if (path === '/api/simulate') return simulate(body);
    if (path === '/api/scenarios/save') {
      saved.push(body);
      return json(scenario({ scenario_id: 99, scenario_name: String(body.scenario_name) }), 201);
    }
    return json({ detail: 'not found' }, 404);
  });
  return { saved };
}

describe('useScenarioSimulator', () => {
  it('reports an unreachable backend and keeps the illustrative case flagged', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useScenarioSimulator());

    await waitFor(() => expect(result.current.backendOnline).toBe(false));
    await waitFor(() => expect(result.current.historyError).toBe(`cannot reach the backend at ${API_BASE_URL}`));
    expect(result.current.resultLive).toBe(false);
    expect(result.current.history).toEqual([]);
  });

  it('shows the backend result and audit trail once it answers', async () => {
    backend();
    const { result } = renderHook(() => useScenarioSimulator());

    await waitFor(() => expect(result.current.resultLive).toBe(true));
    expect(result.current.currentResult.scenario_name).toBe('From backend');
    await waitFor(() => expect(result.current.history.map((s) => s.scenario_name)).toEqual(['Seed']));
    expect(result.current.storageMode).toBe('memory');
    expect(result.current.backendOnline).toBe(true);
  });

  it('saves only the inputs and says the scenario lives in memory', async () => {
    const { saved } = backend();
    const { result } = renderHook(() => useScenarioSimulator());
    await waitFor(() => expect(result.current.resultLive).toBe(true));
    await waitFor(() => expect(result.current.storageMode).toBe('memory'));

    await act(() => result.current.handleSaveScenario());

    expect(saved).toEqual([
      {
        scenario_name: 'Demand Surge (+20%) Analysis',
        base_demand: 10000,
        demand_change_pct: 20,
        enable_ot: false,
        created_by: 'Sales & Operations Consensus',
      },
    ]);
    expect(result.current.history[0].scenario_id).toBe(99);
    expect(result.current.toastMessage?.text).toContain('saved in backend memory only');
  });

  it('shows the validation error and keeps the previous result', async () => {
    backend((body) =>
      body.base_demand === 0
        ? json({ detail: [{ loc: ['body', 'base_demand'], msg: 'Input should be greater than 0' }] }, 422)
        : json(scenario()),
    );
    const { result } = renderHook(() => useScenarioSimulator());
    await waitFor(() => expect(result.current.resultLive).toBe(true));
    const before = result.current.currentResult;

    act(() => result.current.setBaseDemand(0));
    await act(() => result.current.handleRunSimulation());

    expect(result.current.toastMessage).toEqual({
      text: 'Simulation failed: base_demand: Input should be greater than 0',
      type: 'error',
    });
    expect(result.current.currentResult).toBe(before);
    expect(result.current.backendOnline).toBe(true);
  });
});
