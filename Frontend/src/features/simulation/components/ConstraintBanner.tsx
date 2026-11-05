import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { ScenarioResult } from '../types';

// Feasible / bottleneck verdict of the current result
export function ConstraintBanner({ currentResult }: { currentResult: ScenarioResult }) {
  const isOverload = currentResult.forecast_demand > currentResult.capacity_limit;

  return (
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
  );
}
