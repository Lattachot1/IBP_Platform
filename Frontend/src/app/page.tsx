'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Play,
  Save,
  RotateCcw,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Factory,
  Layers,
  DollarSign,
  Percent,
  Clock,
  ArrowRight,
  ShieldCheck,
  Building2,
  Database,
  Cpu,
  RefreshCw,
  Sparkles,
  Info
} from 'lucide-react';
import { DemandForecastPanel } from '../components/DemandForecastPanel';
import { ModelPerformancePanel } from '../components/ModelPerformancePanel';
import { ApiError, readJson } from '../lib/apiError';

// Data Interfaces
interface ScenarioResult {
  scenario_id?: number;
  scenario_name: string;
  base_demand: number;
  demand_change_pct: number;
  forecast_demand: number;
  lower_bound: number;
  upper_bound: number;
  capacity_limit: number;
  enable_ot: boolean;
  actual_produce: number;
  shortage_qty: number;
  service_level_pct: number;
  revenue_thb: number;
  extra_cost_thb: number;
  constraint_status: string;
  model_name: string;
  created_by: string;
  created_at?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const OFFLINE_MESSAGE = `cannot reach the backend at ${API_BASE_URL}`;

// What-if inputs; every figure on the page is computed from them by the backend
interface SimulationInputs {
  scenario_name: string;
  base_demand: number;
  demand_change_pct: number;
  enable_ot: boolean;
  created_by: string;
}

const INITIAL_INPUTS: SimulationInputs = {
  scenario_name: 'Demand Surge (+20%) Analysis',
  base_demand: 10000,
  demand_change_pct: 20,
  enable_ot: false,
  created_by: 'Sales & Operations Consensus',
};

// Preset definitions directly from Capstone Slide 15
type PresetType = 'base' | 'surge' | 'ot';
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
async function requestSimulation(inputs: SimulationInputs): Promise<ScenarioResult> {
  const res = await fetch(`${API_BASE_URL}/api/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inputs),
  });
  return readJson<ScenarioResult>(res);
}

export default function IBPPlatformDashboard() {
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
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

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
    const reachable = err instanceof ApiError;
    setBackendOnline(reachable);
    showToast(`${action} failed: ${reachable ? err.message : OFFLINE_MESSAGE}`, 'error');
  };

  // Check Backend Health (and where saved scenarios end up)
  const checkBackendHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`, { method: 'GET', credentials: 'omit' });
      const health = await readJson<{ storage?: 'database' | 'memory' }>(res);
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
      const data = await readJson<ScenarioResult[]>(await fetch(`${API_BASE_URL}/api/scenarios`));
      setHistory(data);
      setHistoryError(null);
      setBackendOnline(true);
    } catch (err) {
      setHistory([]);
      setHistoryError(err instanceof ApiError ? err.message : OFFLINE_MESSAGE);
      if (!(err instanceof ApiError)) setBackendOnline(false);
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
      const res = await fetch(`${API_BASE_URL}/api/scenarios/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_name: scenarioName || 'What-If Plan',
          base_demand: currentResult.base_demand,
          demand_change_pct: currentResult.demand_change_pct,
          enable_ot: currentResult.enable_ot,
          created_by: createdBy || 'Planner',
        }),
      });
      const saved = await readJson<ScenarioResult>(res);
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

  const isOverload = currentResult.forecast_demand > currentResult.capacity_limit;
  const capacityUtilizationPct = currentResult.capacity_limit > 0
    ? Math.min(100, Math.round((currentResult.actual_produce / currentResult.capacity_limit) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 transition-all transform ease-out duration-300">
          <div
            className={`px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 border ${
              toastMessage.type === 'success'
                ? 'bg-emerald-600 text-white border-emerald-500'
                : toastMessage.type === 'error'
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-slate-800 text-white border-slate-700'
            }`}
          >
            {toastMessage.type === 'success' && <CheckCircle2 className="w-5 h-5" />}
            {toastMessage.type === 'error' && <AlertTriangle className="w-5 h-5" />}
            {toastMessage.type === 'info' && <Info className="w-5 h-5" />}
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Enterprise Executive Header */}
      <header className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white border-b border-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-inner font-black text-xl tracking-wider text-white">
                UBE
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                    Integrated Business Planning (IBP) Platform
                  </h1>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    PoC v1.0
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 mt-0.5 flex items-center gap-2">
                  <span className="text-blue-400 font-semibold">UBE Chemicals (Asia) PCL</span>
                  <span className="text-slate-500">•</span>
                  <span>&quot;One Platform · One Data · One Plan&quot;</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-amber-400 font-medium">Topic 45 | Team CALTLAPSE</span>
                </p>
              </div>
            </div>

            {/* Status & Actions */}
            <div className="flex items-center gap-3 self-end md:self-auto">
              <Link
                href="/optimize"
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Factory className="w-3.5 h-3.5" />
                Production Optimization
              </Link>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    backendOnline === true
                      ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400'
                      : backendOnline === false
                      ? 'bg-amber-400'
                      : 'bg-slate-400'
                  }`}
                />
                <span>
                  {backendOnline === true
                    ? 'Backend Live (Port 8080)'
                    : backendOnline === false
                    ? 'Backend Offline'
                    : 'Connecting Engine...'}
                </span>
              </div>

              <div className="px-3 py-1.5 rounded-lg bg-blue-900/40 border border-blue-700/50 text-xs font-medium text-blue-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>Pilot Product Family: Line A</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Benchmark Presets Bar (Capstone Slide 15) */}
        <section className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span>Capstone Executive Presets:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => applyPreset('base')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
            >
              Preset 1: Base Case (10k, 0%)
            </button>
            <button
              onClick={() => applyPreset('surge')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-colors"
            >
              Preset 2: Demand Surge (+20%, No OT)
            </button>
            <button
              onClick={() => applyPreset('ot')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors"
            >
              Preset 3: Add Overtime (+20% + OT)
            </button>
          </div>
        </section>

        {/* Top Grid: Simulator Controls & Constraint Alert */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Simulator Controls Card */}
          <div className="lg:col-span-5 bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-bold text-slate-800">What-If Scenario Simulator</h2>
                </div>
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                  Digital Simulator v1
                </span>
              </div>

              <div className="space-y-4 text-sm">
                {/* Scenario Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Scenario Title
                  </label>
                  <input
                    type="text"
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                    placeholder="e.g. Q4 Peak Surge with Weekend Shift"
                    maxLength={100}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-slate-50/50"
                  />
                </div>

                {/* Base Demand Input */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-600">
                      Base Demand (Historical Baseline)
                    </label>
                    <span className="text-xs text-slate-500 font-mono">
                      {Number(baseDemand).toLocaleString()} units/mo
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={baseDemand}
                      onChange={(e) => setBaseDemand(Number(e.target.value))}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-slate-50/50"
                      min={1000}
                      step={500}
                    />
                    <span className="absolute right-3 top-2 text-xs text-slate-400 pointer-events-none">
                      Units
                    </span>
                  </div>
                </div>

                {/* Demand Change Percentage */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-600">
                      Expected Demand Change (%)
                    </label>
                    <span
                      className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                        demandChangePct > 0
                          ? 'bg-blue-100 text-blue-700'
                          : demandChangePct < 0
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {demandChangePct > 0 ? `+${demandChangePct}%` : `${demandChangePct}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={100}
                    step={5}
                    value={demandChangePct}
                    onChange={(e) => setDemandChangePct(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>-50% (Downturn)</span>
                    <span>0% (Baseline)</span>
                    <span>+50%</span>
                    <span>+100% (Surge)</span>
                  </div>
                </div>

                {/* Overtime Decision Lever */}
                <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/50">
                  <div className="flex items-start gap-3">
                    <input
                      id="enableOTCheckbox"
                      type="checkbox"
                      checked={enableOT}
                      onChange={(e) => setEnableOT(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <label htmlFor="enableOTCheckbox" className="text-xs cursor-pointer">
                      <span className="font-bold text-slate-900 block">
                        Activate Overtime (OT) Decision Lever
                      </span>
                      <span className="text-slate-600 block mt-0.5 leading-relaxed">
                        Expands plant capacity from <strong className="text-slate-800">10,500</strong> to{' '}
                        <strong className="text-blue-700">12,000 units</strong> (+1,500 units) at an incremental cost of{' '}
                        <strong className="text-amber-800">+120,000 THB</strong>.
                      </span>
                    </label>
                  </div>
                </div>

                {/* Created By / Role */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Planner / Team Responsibility
                  </label>
                  <input
                    type="text"
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                    maxLength={50}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-slate-50/50"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center gap-3">
              <button
                onClick={handleRunSimulation}
                disabled={isSimulating}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-sm transition-colors disabled:opacity-50"
              >
                {isSimulating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Recalculating...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Run Simulation</span>
                  </>
                )}
              </button>

              <button
                onClick={handleSaveScenario}
                disabled={isSaving || !resultLive}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 active:bg-slate-300 transition-colors disabled:opacity-50"
                title={resultLive ? 'Save Scenario into Database Audit Trail' : 'Run a simulation on the backend first'}
              >
                <Save className="w-4 h-4 text-slate-600" />
                <span>Save</span>
              </button>
            </div>
          </div>

          {/* Right Side: KPI Cards & Constraint Alert Banner */}
          <div className="lg:col-span-7 space-y-6">
            {/* Not-live notice: the figures below were not computed by the backend */}
            {!resultLive && (
              <div className="rounded-xl px-4 py-3 border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {backendOnline === false
                    ? `Backend offline (${API_BASE_URL}): the figures below are the illustrative starting case, not a live result. Start the backend to run or save simulations.`
                    : 'Connecting to the simulation engine: the figures below are the illustrative starting case until it answers.'}
                </span>
              </div>
            )}

            {/* Status Alert Banner */}
            <div
              className={`rounded-2xl p-5 border shadow-sm transition-all ${
                isOverload
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              <div className="flex items-start gap-3.5">
                {isOverload ? (
                  <div className="p-2 rounded-xl bg-rose-100 text-rose-600">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                ) : (
                  <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        isOverload ? 'bg-rose-200 text-rose-800' : 'bg-emerald-200 text-emerald-800'
                      }`}
                    >
                      {isOverload ? 'Bottleneck Detected' : 'Plan Feasible'}
                    </span>
                    <h3 className="text-base font-bold">
                      {currentResult.constraint_status}
                    </h3>
                  </div>
                  <p className="text-xs sm:text-sm mt-1.5 leading-relaxed opacity-90">
                    {isOverload ? (
                      <>
                        Forecast demand (<strong>{currentResult.forecast_demand.toLocaleString()} units</strong>) exceeds
                        plant capacity limit (<strong>{currentResult.capacity_limit.toLocaleString()} units</strong>).
                        Expected stock-out / shortage of{' '}
                        <span className="font-bold underline">{currentResult.shortage_qty.toLocaleString()} units</span>.
                        Service level degrades to{' '}
                        <strong>{currentResult.service_level_pct.toFixed(1)}%</strong>. Consider activating Overtime lever.
                      </>
                    ) : (
                      <>
                        All forecast demand (<strong>{currentResult.forecast_demand.toLocaleString()} units</strong>) is fully
                        supported by production capacity (<strong>{currentResult.capacity_limit.toLocaleString()} units</strong>).
                        Service level achieved:{' '}
                        <strong>{currentResult.service_level_pct.toFixed(1)}%</strong> with zero customer shortage.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* 4 Core Executive KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Card 1: Demand Forecast */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Demand Forecast</span>
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                    {currentResult.forecast_demand.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-500">units/mo</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">95% Confidence Band:</span>
                  <span className="font-mono font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                    [{currentResult.lower_bound.toLocaleString()} - {currentResult.upper_bound.toLocaleString()}]
                  </span>
                </div>
              </div>

              {/* Card 2: Production Capacity */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Production Output</span>
                  <Factory className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                    {currentResult.actual_produce.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    / {currentResult.capacity_limit.toLocaleString()} max
                  </span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-100">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">Capacity Utilization:</span>
                    <span className="font-mono font-bold text-slate-800">{capacityUtilizationPct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        capacityUtilizationPct >= 100 ? 'bg-amber-500' : 'bg-indigo-600'
                      }`}
                      style={{ width: `${capacityUtilizationPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Card 3: Service Level */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Service Level (OTIF)</span>
                  <Percent className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-2xl sm:text-3xl font-black font-mono ${
                      currentResult.service_level_pct >= 95
                        ? 'text-emerald-600'
                        : currentResult.service_level_pct >= 85
                        ? 'text-amber-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {currentResult.service_level_pct.toFixed(1)}%
                  </span>
                  <span className="text-xs text-slate-500">fulfillment</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Shortage Impact:</span>
                  <span
                    className={`font-mono font-bold px-2 py-0.5 rounded ${
                      currentResult.shortage_qty > 0
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {currentResult.shortage_qty > 0
                      ? `-${currentResult.shortage_qty.toLocaleString()} units`
                      : '0 shortage'}
                  </span>
                </div>
              </div>

              {/* Card 4: Financial Translation */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Supported Revenue</span>
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                    {(currentResult.revenue_thb / 1000000).toFixed(2)}M
                  </span>
                  <span className="text-xs text-slate-500">THB</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Incremental OT Cost:</span>
                  <span
                    className={`font-mono font-medium ${
                      currentResult.extra_cost_thb > 0 ? 'text-amber-700 font-bold' : 'text-slate-600'
                    }`}
                  >
                    {currentResult.extra_cost_thb > 0
                      ? `+${currentResult.extra_cost_thb.toLocaleString()} THB`
                      : '0 THB'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Value Chain Impact Flow Diagram (Capstone Slide 4 & 15) */}
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" />
                <span>Integrated Value Chain Impact Flow</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Propagation of a single demand change across all functional departments simultaneously
              </p>
            </div>
            <span className="hidden sm:inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
              One Integrated Decision Cycle
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 relative">
            {/* Step 1: Demand */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">1. Demand</span>
                <h4 className="text-sm font-bold text-slate-800 mt-1">Market Forecast</h4>
                <p className="text-xs text-slate-500 mt-1">Point & interval estimation</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200">
                <div className="text-base font-mono font-bold text-slate-900">
                  {currentResult.forecast_demand.toLocaleString()} <span className="text-xs font-normal">units</span>
                </div>
                <div className="text-[11px] text-blue-600 font-medium">
                  {currentResult.demand_change_pct >= 0 ? `+${currentResult.demand_change_pct}%` : `${currentResult.demand_change_pct}%`} vs Base
                </div>
              </div>
            </div>

            {/* Step 2: Capacity Constraint */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">2. Constraint</span>
                <h4 className="text-sm font-bold text-slate-800 mt-1">Plant Capacity</h4>
                <p className="text-xs text-slate-500 mt-1">Machine & line bottleneck</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200">
                <div className="text-base font-mono font-bold text-slate-900">
                  {currentResult.capacity_limit.toLocaleString()} <span className="text-xs font-normal">limit</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {currentResult.enable_ot ? 'OT Lever (+1,500)' : 'Standard Shift'}
                </div>
              </div>
            </div>

            {/* Step 3: Inventory & Shortage */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">3. Inventory</span>
                <h4 className="text-sm font-bold text-slate-800 mt-1">Stock Balance</h4>
                <p className="text-xs text-slate-500 mt-1">Stock-out & buffer risk</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200">
                <div
                  className={`text-base font-mono font-bold ${
                    currentResult.shortage_qty > 0 ? 'text-rose-600' : 'text-emerald-600'
                  }`}
                >
                  {currentResult.shortage_qty > 0 ? `${currentResult.shortage_qty.toLocaleString()} units` : 'Zero Stock-out'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {currentResult.shortage_qty > 0 ? 'Shortage in Week 3' : 'Buffer Protected'}
                </div>
              </div>
            </div>

            {/* Step 4: Service Level */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">4. Service</span>
                <h4 className="text-sm font-bold text-slate-800 mt-1">Fulfillment Rate</h4>
                <p className="text-xs text-slate-500 mt-1">Customer OTIF delivery</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200">
                <div
                  className={`text-base font-mono font-bold ${
                    currentResult.service_level_pct >= 95
                      ? 'text-emerald-600'
                      : currentResult.service_level_pct >= 85
                      ? 'text-amber-600'
                      : 'text-rose-600'
                  }`}
                >
                  {currentResult.service_level_pct.toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500">Target: ≥95.0%</div>
              </div>
            </div>

            {/* Step 5: Financial Translation */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-700">5. Financial</span>
                <h4 className="text-sm font-bold text-slate-800 mt-1">P&L Translation</h4>
                <p className="text-xs text-slate-500 mt-1">Revenue vs Overtime cost</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200">
                <div className="text-base font-mono font-bold text-slate-900">
                  {(currentResult.revenue_thb / 1000000).toFixed(2)}M THB
                </div>
                <div className="text-[11px] text-amber-700 font-medium">
                  {currentResult.extra_cost_thb > 0 ? `Cost: +120k THB` : 'Cost: 0 THB'}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI Demand Forecast (real billing data) */}
        <DemandForecastPanel />
        <ModelPerformancePanel />

        {/* Audit Trail & Scenario Comparison Table */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-800">
                  Scenario Audit Trail & Comparison Log
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Version-controlled scenario records (
                {storageMode === 'database'
                  ? 'MS SQL Server'
                  : storageMode === 'memory'
                  ? 'in-memory store: no database configured, cleared when the backend restarts'
                  : 'MS SQL Server / In-Memory Store'}
                )
              </p>
            </div>

            <button
              onClick={fetchScenarios}
              disabled={isLoadingHistory}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
              <span>Refresh History</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3.5 px-4">Scenario Details</th>
                  <th className="py-3.5 px-4 text-right">Base / %</th>
                  <th className="py-3.5 px-4 text-right">Forecast</th>
                  <th className="py-3.5 px-4 text-right">Output / Cap</th>
                  <th className="py-3.5 px-4 text-right">Shortage</th>
                  <th className="py-3.5 px-4 text-right">Service %</th>
                  <th className="py-3.5 px-4 text-right">Revenue (THB)</th>
                  <th className="py-3.5 px-4 text-right">OT Cost</th>
                  <th className="py-3.5 px-4">Constraint Status</th>
                  <th className="py-3.5 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {historyError ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-rose-600">
                      Could not load the audit trail: {historyError}. Use &quot;Refresh History&quot; to try again.
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      No saved scenarios found. Run a simulation and click &quot;Save Scenario&quot;.
                    </td>
                  </tr>
                ) : (
                  history.map((s, idx) => {
                    const isBottleneck = s.shortage_qty > 0;
                    return (
                      <tr key={s.scenario_id || idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">{s.scenario_name}</div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <span>By {s.created_by || 'Unknown'}</span>
                            {s.created_at && (
                              <>
                                <span>•</span>
                                <span>{new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono">
                          <div>{s.base_demand.toLocaleString()}</div>
                          <div className={`text-[10px] font-bold ${s.demand_change_pct > 0 ? 'text-blue-600' : s.demand_change_pct < 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                            {s.demand_change_pct > 0 ? `+${s.demand_change_pct}%` : `${s.demand_change_pct}%`}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800">
                          {s.forecast_demand.toLocaleString()}
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono">
                          <div>{s.actual_produce.toLocaleString()}</div>
                          <div className="text-[10px] text-slate-400">/ {s.capacity_limit.toLocaleString()}</div>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              isBottleneck ? 'bg-rose-100 text-rose-700' : 'text-slate-400'
                            }`}
                          >
                            {s.shortage_qty > 0 ? s.shortage_qty.toLocaleString() : '-'}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono font-bold">
                          <span
                            className={
                              s.service_level_pct >= 95
                                ? 'text-emerald-600'
                                : s.service_level_pct >= 85
                                ? 'text-amber-600'
                                : 'text-rose-600'
                            }
                          >
                            {s.service_level_pct.toFixed(1)}%
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono text-slate-800">
                          {(s.revenue_thb / 1000000).toFixed(2)}M
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono">
                          {s.extra_cost_thb > 0 ? (
                            <span className="text-amber-700 font-medium">+{s.extra_cost_thb.toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                              isBottleneck
                                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                : s.enable_ot
                                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {s.constraint_status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => loadScenarioFromHistory(s)}
                            className="px-2.5 py-1 rounded text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            Load
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 mt-8 border-t border-slate-200 text-center text-xs text-slate-400 space-y-1">
        <p>AI-Driven Integrated Business Planning (IBP) Simulation Platform • UBE Chemicals (Asia) PCL</p>
        <p>Built with Next.js App Router, Unified Python Backend (FastAPI), and MS SQL Server 2022</p>
      </footer>
    </div>
  );
}
