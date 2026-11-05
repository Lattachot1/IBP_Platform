import { Database, RefreshCw } from 'lucide-react';

import type { ScenarioResult } from '../types';

interface ScenarioHistoryTableProps {
  storageMode: 'database' | 'memory' | null;
  history: ScenarioResult[];
  /** Set when the audit trail could not be loaded (shown instead of rows) */
  historyError: string | null;
  isLoadingHistory: boolean;
  onRefresh: () => void;
  onLoad: (scenario: ScenarioResult) => void;
}

// Audit trail & scenario comparison table
export function ScenarioHistoryTable({
  storageMode,
  history,
  historyError,
  isLoadingHistory,
  onRefresh,
  onLoad,
}: ScenarioHistoryTableProps) {
  return (
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
          onClick={onRefresh}
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
                        onClick={() => onLoad(s)}
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
  );
}
