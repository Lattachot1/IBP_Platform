import { DollarSign, Factory, Percent, TrendingUp } from 'lucide-react';

import type { ScenarioResult } from '../types';

// The four executive KPI cards
export function KpiCards({ currentResult }: { currentResult: ScenarioResult }) {
  const capacityUtilizationPct = currentResult.capacity_limit > 0
    ? Math.min(100, Math.round((currentResult.actual_produce / currentResult.capacity_limit) * 100))
    : 0;

  return (
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
  );
}
