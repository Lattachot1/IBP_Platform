import { Cpu, Play, RefreshCw, Save } from 'lucide-react';

interface SimulatorFormProps {
  scenarioName: string;
  setScenarioName: (value: string) => void;
  baseDemand: number;
  setBaseDemand: (value: number) => void;
  demandChangePct: number;
  setDemandChangePct: (value: number) => void;
  enableOT: boolean;
  setEnableOT: (value: boolean) => void;
  createdBy: string;
  setCreatedBy: (value: string) => void;
  isSimulating: boolean;
  isSaving: boolean;
  /** False until the backend has computed the shown result: Save stays disabled */
  resultLive: boolean;
  onRun: () => void;
  onSave: () => void;
}

// What-if inputs and the Run / Save actions
export function SimulatorForm({
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
  resultLive,
  onRun,
  onSave,
}: SimulatorFormProps) {
  return (
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
          onClick={onRun}
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
          onClick={onSave}
          disabled={isSaving || !resultLive}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 active:bg-slate-300 transition-colors disabled:opacity-50"
          title={resultLive ? 'Save Scenario into Database Audit Trail' : 'Run a simulation on the backend first'}
        >
          <Save className="w-4 h-4 text-slate-600" />
          <span>Save</span>
        </button>
      </div>
    </div>
  );
}
