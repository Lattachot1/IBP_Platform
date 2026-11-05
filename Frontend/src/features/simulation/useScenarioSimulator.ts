// State and backend calls of the What-if dashboard. Every figure comes from
// the backend (POST /api/simulate); a failed call is reported, never
// replaced by numbers computed here.

import { useCallback, useEffect, useState } from 'react';

import { backendAnswered, describeFailure, getJson, postJson } from '@/lib/apiClient';

import type { ScenarioResult, SimulationInputs } from './types';

export interface ToastMessage {
  text: string;
  type: 'success' | 'error' | 'info';
}

const INITIAL_INPUTS: SimulationInputs = {
  scenario_name: 'Demand Surge (+20%) Analysis',
  base_demand: 10000,
  demand_change_pct: 20,
  enable_ot: false,
  created_by: 'Sales & Operations Consensus',
};

// Preset definitions directly from Capstone Slide 15
export type PresetType = 'base' | 'surge' | 'ot';
const PRESETS: Record<PresetType, { inputs: Omit<SimulationInputs, 'created_by'>; toast: string; toastType: 'info' | 'success' }> = {
  base: {
    inputs: { scenario_name: 'Base Plan (Normal Demand)', base_demand: 10000, demand_change_pct: 0, enable_ot: false },
    toast: 'Loaded Preset: Base Plan (Normal Baseline)',
    toastType: 'info',
  },
  surge: {
    inputs: { scenario_name: 'Demand Surge (+20%) - Constrained', base_demand: 10000, demand_change_pct: 20, enable_ot: false },
    toast: 'Loaded Preset: Demand Surge (+20%) - Bottleneck Detected!',
    toastType: 'info',
  },
  ot: {
    inputs: { scenario_name: 'Demand Surge (+20%) - With Overtime', base_demand: 10000, demand_change_pct: 20, enable_ot: true },
    toast: 'Loaded Preset: Demand Surge (+20%) with Overtime Activated',
    toastType: 'success',
  },
};

// POST /api/simulate - the planning rules live only in the backend
function requestSimulation(inputs: SimulationInputs): Promise<ScenarioResult> {
  return postJson<ScenarioResult>('/api/simulate', inputs);
}

export function useScenarioSimulator() {
  // Input State
  const [scenarioName, setScenarioName] = useState<string>(INITIAL_INPUTS.scenario_name);
  const [baseDemand, setBaseDemand] = useState<number>(INITIAL_INPUTS.base_demand);
  const [demandChangePct, setDemandChangePct] = useState<number>(INITIAL_INPUTS.demand_change_pct);
  const [enableOT, setEnableOT] = useState<boolean>(INITIAL_INPUTS.enable_ot);
  const [createdBy, setCreatedBy] = useState<string>(INITIAL_INPUTS.created_by);

  // Execution State
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [storageMode, setStorageMode] = useState<'database' | 'memory' | null>(null);
  const [toastMessage, setToastMessage] = useState<ToastMessage | null>(null);

  // Simulation Result State. Starts as the illustrative Capstone case so the
  // layout renders; resultLive stays false (and the page says so) until the
  // backend has computed a result.
  const [resultLive, setResultLive] = useState<boolean>(false);
  const [currentResult, setCurrentResult] = useState<ScenarioResult>({
    scenario_name: 'Demand Surge (+20%) - Constrained Bottleneck',
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
    constraint_status: 'Capacity Overload Bottleneck (Shortage: 1,500 units)',
    model_name: 'Ensemble Baseline (ETS/ML)',
    created_by: 'Sales & Operations Consensus',
    created_at: new Date().toISOString()
  });

  // History / Audit Trail State
  const [history, setHistory] = useState<ScenarioResult[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);

  // Helper for notification toasts
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // A failed backend call: say what failed and why, never substitute data
  const reportFailure = (action: string, err: unknown) => {
    setBackendOnline(backendAnswered(err));
    showToast(`${action} failed: ${describeFailure(err)}`, 'error');
  };

  // Check Backend Health (and where saved scenarios end up)
  const checkBackendHealth = useCallback(async () => {
    try {
      const health = await getJson<{ storage?: 'database' | 'memory' }>('/api/health');
      setBackendOnline(true);
      setStorageMode(health.storage ?? null);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  // Fetch Scenarios from Backend
  const fetchScenarios = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const data = await getJson<ScenarioResult[]>('/api/scenarios');
      setHistory(data);
      setHistoryError(null);
      setBackendOnline(true);
    } catch (err) {
      setHistory([]);
      setHistoryError(describeFailure(err));
      if (!backendAnswered(err)) setBackendOnline(false);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    checkBackendHealth();
    fetchScenarios();
    // Replace the illustrative starting case with the backend's own result
    requestSimulation(INITIAL_INPUTS)
      .then((result) => {
        setCurrentResult(result);
        setResultLive(true);
      })
      .catch(() => {
        // the "not a live result" banner already tells the planner
      });
  }, [checkBackendHealth, fetchScenarios]);

  // Run a simulation on the backend and show its result
  const simulate = async (inputs: SimulationInputs, successToast: string, toastType: 'info' | 'success' = 'success') => {
    setIsSimulating(true);
    try {
      const result = await requestSimulation(inputs);
      setCurrentResult(result);
      setResultLive(true);
      setBackendOnline(true);
      showToast(successToast, toastType);
    } catch (err) {
      reportFailure('Simulation', err);
    } finally {
      setIsSimulating(false);
    }
  };

  // Run What-If Simulation
  const handleRunSimulation = () =>
    simulate(
      {
        scenario_name: scenarioName,
        base_demand: Number(baseDemand),
        demand_change_pct: Number(demandChangePct),
        enable_ot: enableOT,
        created_by: createdBy,
      },
      'Simulation calculated successfully via Backend Engine!',
    );

  // Save Scenario to Audit Trail. Only the inputs are sent: the backend
  // recomputes every figure before storing it.
  const handleSaveScenario = async () => {
    setIsSaving(true);
    try {
      const saved = await postJson<ScenarioResult>('/api/scenarios/save', {
        scenario_name: scenarioName || 'What-If Plan',
        base_demand: currentResult.base_demand,
        demand_change_pct: currentResult.demand_change_pct,
        enable_ot: currentResult.enable_ot,
        created_by: createdBy || 'Planner',
      });
      setHistory((prev) => [saved, ...prev]);
      setHistoryError(null);
      setBackendOnline(true);
      if (storageMode === 'memory') {
        showToast(`Scenario "${saved.scenario_name}" saved in backend memory only (no database configured: lost when the backend restarts)`, 'info');
      } else {
        showToast(`Scenario "${saved.scenario_name}" saved to ${storageMode === 'database' ? 'Database & ' : ''}Audit Trail!`, 'success');
      }
    } catch (err) {
      reportFailure('Save', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Preset Handlers directly from Capstone Slide 15
  const applyPreset = (presetType: PresetType) => {
    const { inputs, toast, toastType } = PRESETS[presetType];
    setScenarioName(inputs.scenario_name);
    setBaseDemand(inputs.base_demand);
    setDemandChangePct(inputs.demand_change_pct);
    setEnableOT(inputs.enable_ot);
    simulate({ ...inputs, created_by: createdBy }, toast, toastType);
  };

  // Load a scenario from the table back into the editor
  const loadScenarioFromHistory = (s: ScenarioResult) => {
    setScenarioName(s.scenario_name);
    setBaseDemand(s.base_demand);
    setDemandChangePct(s.demand_change_pct);
    setEnableOT(s.enable_ot);
    if (s.created_by) setCreatedBy(s.created_by);
    setCurrentResult(s);
    setResultLive(true);
    showToast(`Loaded "${s.scenario_name}" into simulator`, 'info');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return {
    scenarioName,
    setScenarioName,
    baseDemand,
    setBaseDemand,
    demandChangePct,
    setDemandChangePct,
    enableOT,
    setEnableOT,
    createdBy,
    setCreatedBy,
    isSimulating,
    isSaving,
    backendOnline,
    storageMode,
    toastMessage,
    resultLive,
    currentResult,
    history,
    historyError,
    isLoadingHistory,
    fetchScenarios,
    handleRunSimulation,
    handleSaveScenario,
    applyPreset,
    loadScenarioFromHistory,
  };
}
