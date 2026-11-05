// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScenarioResult } from '../types';
import { ScenarioHistoryTable } from './ScenarioHistoryTable';

afterEach(cleanup);

const row: ScenarioResult = {
  scenario_id: 3,
  scenario_name: 'Demand Surge (+20%) - With Overtime Lever',
  base_demand: 10000,
  demand_change_pct: 20,
  forecast_demand: 12000,
  lower_bound: 11400,
  upper_bound: 12600,
  capacity_limit: 12000,
  enable_ot: true,
  actual_produce: 12000,
  shortage_qty: 0,
  service_level_pct: 100,
  revenue_thb: 12000000,
  extra_cost_thb: 120000,
  constraint_status: 'Feasible (Overtime Shift Activated)',
  model_name: 'Ensemble Baseline (ETS/ML)',
  created_by: 'Executive Committee',
};

function renderTable(props: Partial<Parameters<typeof ScenarioHistoryTable>[0]> = {}) {
  const onRefresh = vi.fn();
  const onLoad = vi.fn();
  render(
    <ScenarioHistoryTable
      storageMode="memory"
      history={[]}
      historyError={null}
      isLoadingHistory={false}
      onRefresh={onRefresh}
      onLoad={onLoad}
      {...props}
    />,
  );
  return { onRefresh, onLoad };
}

describe('ScenarioHistoryTable', () => {
  it('shows a load error instead of rows', () => {
    renderTable({ historyError: 'cannot reach the backend at http://localhost:8080', history: [row] });
    expect(screen.getByText(/Could not load the audit trail: cannot reach the backend/)).toBeTruthy();
    expect(screen.queryByText(row.scenario_name)).toBeNull();
  });

  it('says when nothing has been saved yet', () => {
    renderTable();
    expect(screen.getByText(/No saved scenarios found/)).toBeTruthy();
  });

  it('lists scenarios and loads one back into the simulator', () => {
    const { onLoad } = renderTable({ history: [row] });
    expect(screen.getByText(row.scenario_name)).toBeTruthy();
    expect(screen.getByText('12.00M')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(onLoad).toHaveBeenCalledWith(row);
  });

  it('names where the records are stored', () => {
    renderTable({ storageMode: 'database' });
    expect(screen.getByText(/Version-controlled scenario records \(MS SQL Server\)/)).toBeTruthy();
  });

  it('refreshes on request', () => {
    const { onRefresh } = renderTable();
    fireEvent.click(screen.getByRole('button', { name: /Refresh History/ }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
