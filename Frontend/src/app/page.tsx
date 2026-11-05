'use client';

import { DemandForecastPanel } from '@/features/forecast/components/DemandForecastPanel';
import { ModelPerformancePanel } from '@/features/forecast/components/ModelPerformancePanel';
import { ConstraintBanner } from '@/features/simulation/components/ConstraintBanner';
import { DashboardHeader } from '@/features/simulation/components/DashboardHeader';
import { KpiCards } from '@/features/simulation/components/KpiCards';
import { NotLiveNotice } from '@/features/simulation/components/NotLiveNotice';
import { PresetBar } from '@/features/simulation/components/PresetBar';
import { ScenarioHistoryTable } from '@/features/simulation/components/ScenarioHistoryTable';
import { SimulatorForm } from '@/features/simulation/components/SimulatorForm';
import { Toast } from '@/features/simulation/components/Toast';
import { ValueChainFlow } from '@/features/simulation/components/ValueChainFlow';
import { useScenarioSimulator } from '@/features/simulation/useScenarioSimulator';

export default function IBPPlatformDashboard() {
  const sim = useScenarioSimulator();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {sim.toastMessage && <Toast toastMessage={sim.toastMessage} />}

      <DashboardHeader backendOnline={sim.backendOnline} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <PresetBar onApplyPreset={sim.applyPreset} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <SimulatorForm
            scenarioName={sim.scenarioName}
            setScenarioName={sim.setScenarioName}
            baseDemand={sim.baseDemand}
            setBaseDemand={sim.setBaseDemand}
            demandChangePct={sim.demandChangePct}
            setDemandChangePct={sim.setDemandChangePct}
            enableOT={sim.enableOT}
            setEnableOT={sim.setEnableOT}
            createdBy={sim.createdBy}
            setCreatedBy={sim.setCreatedBy}
            isSimulating={sim.isSimulating}
            isSaving={sim.isSaving}
            resultLive={sim.resultLive}
            onRun={sim.handleRunSimulation}
            onSave={sim.handleSaveScenario}
          />

          {/* Right Side: KPI Cards & Constraint Alert Banner */}
          <div className="lg:col-span-7 space-y-6">
            {!sim.resultLive && <NotLiveNotice backendOnline={sim.backendOnline} />}
            <ConstraintBanner currentResult={sim.currentResult} />
            <KpiCards currentResult={sim.currentResult} />
          </div>
        </div>

        <ValueChainFlow currentResult={sim.currentResult} />

        {/* AI Demand Forecast (real billing data) */}
        <DemandForecastPanel />
        <ModelPerformancePanel />

        <ScenarioHistoryTable
          storageMode={sim.storageMode}
          history={sim.history}
          historyError={sim.historyError}
          isLoadingHistory={sim.isLoadingHistory}
          onRefresh={sim.fetchScenarios}
          onLoad={sim.loadScenarioFromHistory}
        />
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 mt-8 border-t border-slate-200 text-center text-xs text-slate-400 space-y-1">
        <p>AI-Driven Integrated Business Planning (IBP) Simulation Platform • UBE Chemicals (Asia) PCL</p>
        <p>Built with Next.js App Router, Unified Python Backend (FastAPI), and MS SQL Server 2022</p>
      </footer>
    </div>
  );
}
