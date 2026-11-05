import { Layers } from 'lucide-react';

import type { ScenarioResult } from '../types';

// Value chain impact flow (Capstone Slide 4 & 15)
export function ValueChainFlow({ currentResult }: { currentResult: ScenarioResult }) {
  return (
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
  );
}
