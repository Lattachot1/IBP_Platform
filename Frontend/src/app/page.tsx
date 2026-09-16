'use client';

import React, { useState, useEffect, useCallback } from 'react';
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

export default function IBPPlatformDashboard() {
  // Input State
  const [scenarioName, setScenarioName] = useState<string>('Demand Surge (+20%) Analysis');
  const [baseDemand, setBaseDemand] = useState<number>(10000);
  const [demandChangePct, setDemandChangePct] = useState<number>(20);
  const [enableOT, setEnableOT] = useState<boolean>(false);
  const [createdBy, setCreatedBy] = useState<string>('Sales & Operations Consensus');

  // Execution State
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Simulation Result State (Default initialized to Demand Surge without OT)
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
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);

  // Helper for notification toasts
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Local fallback calculation when backend is not reached
  const runLocalSimulation = useCallback((name: string, base: number, pct: number, ot: boolean, creator: string): ScenarioResult => {
    const forecast = Math.round(base * (1 + pct / 100) * 100) / 100;
    const lower = Math.round(forecast * 0.95 * 100) / 100;
    const upper = Math.round(forecast * 1.05 * 100) / 100;
    const capLimit = ot ? 12000 : 10500;
    const extraCost = ot ? 120000 : 0;
    const actual = Math.min(forecast, capLimit);
    const shortage = Math.max(0, forecast - actual);
    const serviceLevel = forecast > 0 ? Math.round((actual / forecast) * 10000) / 100 : 100;
    const revenue = Math.round(actual * 1000);

    let status = 'Feasible / Normal Capacity';
    if (forecast > capLimit) {
      status = `Capacity Overload Bottleneck (Shortage: ${shortage.toLocaleString()} units)`;
    } else if (ot) {
      status = 'Feasible (Overtime Shift Activated)';
    }

    return {
      scenario_name: name,
      base_demand: base,
      demand_change_pct: pct,
      forecast_demand: forecast,
      lower_bound: lower,
      upper_bound: upper,
      capacity_limit: capLimit,
      enable_ot: ot,
      actual_produce: actual,
      shortage_qty: shortage,
      service_level_pct: serviceLevel,
      revenue_thb: revenue,
      extra_cost_thb: extraCost,
      constraint_status: status,
      model_name: 'Ensemble Baseline (ETS/ML)',
      created_by: creator,
      created_at: new Date().toISOString()
    };
  }, []);

  // Check Backend Health
  const checkBackendHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`, { method: 'GET', credentials: 'omit' });
      if (res.ok) {
        setBackendOnline(true);
      } else {
        setBackendOnline(false);
      }
    } catch {
      setBackendOnline(false);
    }
  }, []);

  // Fetch Scenarios from Backend
  const fetchScenarios = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/scenarios`);
      if (res.ok) {
        const data: ScenarioResult[] = await res.json();
        setHistory(data);
        setBackendOnline(true);
      } else {
        throw new Error('Backend responded with error');
      }
    } catch {
      // Fallback initial benchmark data
      setHistory([
        {
          scenario_id: 1,
          scenario_name: 'Base Plan (Normal Baseline)',
          base_demand: 10000,
          demand_change_pct: 0,
          forecast_demand: 10000,
          lower_bound: 9500,
          upper_bound: 10500,
          capacity_limit: 10500,
          enable_ot: false,
          actual_produce: 10000,
          shortage_qty: 0,
          service_level_pct: 100,
          revenue_thb: 10000000,
          extra_cost_thb: 0,
          constraint_status: 'Feasible / Normal Capacity',
          model_name: 'Ensemble Baseline (ETS/ML)',
          created_by: 'Supply Chain Lead',
          created_at: new Date(Date.now() - 7200000).toISOString()
        },
        {
          scenario_id: 2,
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
          created_by: 'Sales & Commercial',
          created_at: new Date(Date.now() - 3600000).toISOString()
        },
        {
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
          created_at: new Date(Date.now() - 900000).toISOString()
        }
      ]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    checkBackendHealth();
    fetchScenarios();
  }, [checkBackendHealth, fetchScenarios]);

  // Run What-If Simulation
  const handleRunSimulation = async () => {
    setIsSimulating(true);
    try {
      const payload = {
        scenario_name: scenarioName,
        base_demand: Number(baseDemand),
        demand_change_pct: Number(demandChangePct),
        enable_ot: enableOT,
        created_by: createdBy
      };

      let result: ScenarioResult;

      try {
        const res = await fetch(`${API_BASE_URL}/api/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          result = await res.json();
          setBackendOnline(true);
          showToast('Simulation calculated successfully via Backend Engine!', 'success');
        } else {
          throw new Error('Backend failed');
        }
      } catch {
        // Run local fallback calculation
        result = runLocalSimulation(scenarioName, Number(baseDemand), Number(demandChangePct), enableOT, createdBy);
        setBackendOnline(false);
        showToast('Calculated using local simulation engine (Backend offline)', 'info');
      }

      setCurrentResult(result);
    } catch (err) {
      showToast(`Simulation error: ${String(err)}`, 'error');
    } finally {
      setIsSimulating(false);
    }
  };

  // Save Scenario to Audit Trail
  const handleSaveScenario = async () => {
    setIsSaving(true);
    try {
      const scenarioToSave: ScenarioResult = {
        ...currentResult,
        scenario_name: scenarioName || 'What-If Plan',
        created_by: createdBy || 'Planner',
        created_at: new Date().toISOString()
      };

      try {
        const res = await fetch(`${API_BASE_URL}/api/scenarios/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scenarioToSave)
        });

        if (res.ok) {
          const saved = await res.json();
          setHistory(prev => [saved, ...prev]);
          showToast(`Scenario "${scenarioToSave.scenario_name}" saved to Database & Audit Trail!`, 'success');
        } else {
          throw new Error('Save API returned error');
        }
      } catch {
        // Fallback save in local state
        const localSaved: ScenarioResult = {
          ...scenarioToSave,
          scenario_id: Date.now()
        };
        setHistory(prev => [localSaved, ...prev]);
        showToast(`Saved to in-browser audit trail (Backend offline)`, 'info');
      }
    } catch (err) {
      showToast(`Save error: ${String(err)}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Preset Handlers directly from Capstone Slide 15
  const applyPreset = (presetType: 'base' | 'surge' | 'ot') => {
    if (presetType === 'base') {
      setScenarioName('Base Plan (Normal Demand)');
      setBaseDemand(10000);
      setDemandChangePct(0);
      setEnableOT(false);
      const res = runLocalSimulation('Base Plan (Normal Demand)', 10000, 0, false, createdBy);
      setCurrentResult(res);
      showToast('Loaded Preset: Base Plan (Normal Baseline)', 'info');
    } else if (presetType === 'surge') {
      setScenarioName('Demand Surge (+20%) - Constrained');
      setBaseDemand(10000);
      setDemandChangePct(20);
      setEnableOT(false);
      const res = runLocalSimulation('Demand Surge (+20%) - Constrained', 10000, 20, false, createdBy);
      setCurrentResult(res);
      showToast('Loaded Preset: Demand Surge (+20%) - Bottleneck Detected!', 'info');
    } else if (presetType === 'ot') {
      setScenarioName('Demand Surge (+20%) - With Overtime');
      setBaseDemand(10000);
      setDemandChangePct(20);
      setEnableOT(true);
      const res = runLocalSimulation('Demand Surge (+20%) - With Overtime', 10000, 20, true, createdBy);
      setCurrentResult(res);
      showToast('Loaded Preset: Demand Surge (+20%) with Overtime Activated', 'success');
    }
  };

  // Load a scenario from the table back into the editor
  const loadScenarioFromHistory = (s: ScenarioResult) => {
    setScenarioName(s.scenario_name);
    setBaseDemand(s.base_demand);
    setDemandChangePct(s.demand_change_pct);
    setEnableOT(s.enable_ot);
    if (s.created_by) setCreatedBy(s.created_by);
    setCurrentResult(s);
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
                  <span>"One Platform · One Data · One Plan"</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-amber-400 font-medium">Topic 45 | Team CALTLAPSE</span>
                </p>
              </div>
            </div>

            {/* Status & Actions */}
            <div className="flex items-center gap-3 self-end md:self-auto">
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
                    ? 'Direct Simulator (Standalone)'
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
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 active:bg-slate-300 transition-colors disabled:opacity-50"
                title="Save Scenario into Database Audit Trail"
              >
                <Save className="w-4 h-4 text-slate-600" />
                <span>Save</span>
              </button>
            </div>
          </div>

          {/* Right Side: KPI Cards & Constraint Alert Banner */}
          <div className="lg:col-span-7 space-y-6">
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
                Version-controlled scenario records (MS SQL Server / In-Memory Store)
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
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      No saved scenarios found. Run a simulation and click "Save Scenario".
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
