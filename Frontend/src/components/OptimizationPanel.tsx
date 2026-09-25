'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Factory,
  Gauge,
  Play,
  RefreshCw,
  Scale,
  Settings2,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  OptimizationDemoRequest,
  OptimizationDemoResponse,
  OptimizationStrategy,
  runOptimizationDemo,
} from '../lib/optimizationApi';

const STRATEGIES: { value: OptimizationStrategy; label: string; short: string }[] = [
  { value: 'deterministic', label: 'Deterministic', short: 'Point forecast' },
  { value: 'stochastic', label: 'Stochastic', short: 'Expected scenarios' },
  { value: 'robust', label: 'Robust', short: 'Worst-case protection' },
];

const DEFAULT_REQUEST: OptimizationDemoRequest = {
  strategy: 'stochastic',
  demand_adjustment_pct: 0,
  capacity_adjustment_pct: 0,
  raw_price_adjustment_pct: 0,
  shortage_penalty_multiplier: 1,
  service_target_pct: 95,
};

const COST_LABELS: Record<string, string> = {
  raw_material: 'Raw material',
  production: 'Production',
  setup: 'Campaign setup',
  overtime: 'Overtime',
  finished_goods_holding: 'FG holding',
  raw_material_holding: 'RM holding',
  shortage: 'Shortage',
  safety_stock_gap: 'Safety-stock gap',
  service_target_violation: 'Service-target gap',
};

const fmt = (value: number, digits = 0) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

const money = (value: number) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${fmt(value)}`;
};

export function OptimizationPanel() {
  const [request, setRequest] = useState<OptimizationDemoRequest>(DEFAULT_REQUEST);
  const [data, setData] = useState<OptimizationDemoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const solve = async (next: OptimizationDemoRequest) => {
    setLoading(true);
    setError(null);
    try {
      const result = await runOptimizationDemo(next);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run optimizer');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    solve(DEFAULT_REQUEST);
  }, []);

  const update = <K extends keyof OptimizationDemoRequest>(
    key: K,
    value: OptimizationDemoRequest[K],
  ) => setRequest((current) => ({ ...current, [key]: value }));

  const selectStrategy = (strategy: OptimizationStrategy) => {
    const next = { ...request, strategy };
    setRequest(next);
    solve(next);
  };

  const applyPreset = (preset: 'base' | 'demand' | 'price') => {
    const next: OptimizationDemoRequest =
      preset === 'demand'
        ? {
            ...DEFAULT_REQUEST,
            strategy: request.strategy,
            demand_adjustment_pct: 15,
            capacity_adjustment_pct: -5,
            shortage_penalty_multiplier: 1.5,
            service_target_pct: 97,
          }
        : preset === 'price'
        ? {
            ...DEFAULT_REQUEST,
            strategy: request.strategy,
            raw_price_adjustment_pct: 15,
          }
        : { ...DEFAULT_REQUEST, strategy: request.strategy };
    setRequest(next);
    solve(next);
  };

  const chartData = useMemo(
    () =>
      data?.strategy_comparison.map((row) => ({
        ...row,
        label: STRATEGIES.find((item) => item.value === row.mode)?.label ?? row.mode,
        expected_cost_m: row.expected_total_cost / 1_000_000,
        worst_cost_m: row.worst_case_cost / 1_000_000,
      })) ?? [],
    [data],
  );

  const selected = data?.selected_plan;
  const maxCost = selected
    ? Math.max(...Object.values(selected.cost_breakdown), 1)
    : 1;

  return (
    <section className="bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-5 sm:px-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Factory className="w-5 h-5 text-cyan-700" />
            <h2 className="text-lg font-bold text-slate-900">Integrated Planning Optimizer</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-amber-50 text-amber-800 border border-amber-200">
              Illustrative assumptions
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">
            Two-month production, inventory and raw-material purchasing plan across six grades.
            Compare point-forecast, expected-scenario and worst-case strategies on the same constraints.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => applyPreset('base')}
            className="px-3 py-2 text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Base
          </button>
          <button
            onClick={() => applyPreset('demand')}
            className="px-3 py-2 text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Demand stress
          </button>
          <button
            onClick={() => applyPreset('price')}
            className="px-3 py-2 text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            BD price shock
          </button>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-5 sm:px-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_2fr_auto] gap-5 items-end">
          <div>
            <label className="text-xs font-semibold text-slate-600">Planning strategy</label>
            <div className="grid grid-cols-3 mt-2 border border-slate-300 bg-white">
              {STRATEGIES.map((strategy) => (
                <button
                  key={strategy.value}
                  onClick={() => selectStrategy(strategy.value)}
                  className={`min-h-14 px-2 py-2 text-left border-r last:border-r-0 border-slate-300 transition-colors ${
                    request.strategy === strategy.value
                      ? 'bg-cyan-700 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-xs font-bold">{strategy.label}</span>
                  <span className={`block text-[10px] mt-0.5 ${request.strategy === strategy.value ? 'text-cyan-100' : 'text-slate-400'}`}>
                    {strategy.short}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Slider
              label="Demand"
              value={request.demand_adjustment_pct}
              min={-20}
              max={30}
              step={1}
              suffix="%"
              onChange={(value) => update('demand_adjustment_pct', value)}
            />
            <Slider
              label="Capacity"
              value={request.capacity_adjustment_pct}
              min={-15}
              max={15}
              step={1}
              suffix="%"
              onChange={(value) => update('capacity_adjustment_pct', value)}
            />
            <Slider
              label="BD price"
              value={request.raw_price_adjustment_pct}
              min={-20}
              max={30}
              step={1}
              suffix="%"
              onChange={(value) => update('raw_price_adjustment_pct', value)}
            />
            <Slider
              label="Shortage cost"
              value={request.shortage_penalty_multiplier}
              min={0.25}
              max={3}
              step={0.25}
              suffix="x"
              onChange={(value) => update('shortage_penalty_multiplier', value)}
            />
            <Slider
              label="Service target"
              value={request.service_target_pct}
              min={85}
              max={99.5}
              step={0.5}
              suffix="%"
              onChange={(value) => update('service_target_pct', value)}
            />
          </div>

          <button
            onClick={() => solve(request)}
            disabled={loading}
            className="h-11 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Optimize
          </button>
        </div>
      </div>

      {error && (
        <div className="m-6 border border-rose-200 bg-rose-50 p-4 flex items-start gap-3 text-sm text-rose-800">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && selected && data && (
        <div className="divide-y divide-slate-200">
          <div className="grid grid-cols-2 lg:grid-cols-4">
            <Kpi label="Expected total cost" value={money(selected.expected_total_cost)} detail={`${money(selected.worst_case_cost)} worst case`} icon={<Scale className="w-4 h-4" />} />
            <Kpi label="Expected service" value={`${selected.expected_service_level_pct.toFixed(1)}%`} detail={`${selected.worst_service_level_pct.toFixed(1)}% worst case`} icon={<ShieldCheck className="w-4 h-4" />} />
            <Kpi label="Expected shortage" value={`${fmt(selected.expected_shortage_tons, 1)} t`} detail={`Target ${request.service_target_pct.toFixed(1)}%`} icon={<Boxes className="w-4 h-4" />} />
            <Kpi label="Overtime used" value={`${fmt(selected.total_overtime_tons, 1)} t`} detail={`${fmt(selected.total_purchase_tons, 0)} t raw material purchased`} icon={<Gauge className="w-4 h-4" />} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr]">
            <div className="p-5 sm:p-6 xl:border-r border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Strategy trade-off</h3>
                  <p className="text-xs text-slate-500">Expected and worst-case cost with expected service on the right axis</p>
                </div>
                <span className="text-xs font-mono text-cyan-700 font-semibold capitalize">{data.selected_strategy}</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis yAxisId="cost" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v: number) => `$${v}M`} width={48} />
                    <YAxis yAxisId="service" orientation="right" domain={[80, 100]} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v: number) => `${v}%`} width={40} />
                    <Tooltip formatter={(value, name) => name === 'Expected service' ? [`${Number(value).toFixed(1)}%`, name] : [`$${Number(value).toFixed(2)}M`, name]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="cost" dataKey="expected_cost_m" name="Expected cost" fill="#0e7490" />
                    <Bar yAxisId="cost" dataKey="worst_cost_m" name="Worst-case cost" fill="#f59e0b" />
                    <Line yAxisId="service" type="monotone" dataKey="expected_service_level_pct" name="Expected service" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="p-5 sm:p-6">
              <h3 className="text-sm font-bold text-slate-900">Expected cost breakdown</h3>
              <p className="text-xs text-slate-500 mt-0.5">Illustrative USD values for the selected plan</p>
              <div className="mt-5 space-y-3">
                {Object.entries(selected.cost_breakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, value]) => (
                    <div key={key}>
                      <div className="flex items-center justify-between text-xs gap-3">
                        <span className="text-slate-600">{COST_LABELS[key] ?? key}</span>
                        <span className="font-mono font-semibold text-slate-800">{money(value)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 mt-1.5 overflow-hidden">
                        <div className="h-full bg-cyan-700" style={{ width: `${Math.max(1, (value / maxCost) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShoppingCart className="w-4 h-4 text-cyan-700" />
              <h3 className="text-sm font-bold text-slate-900">Two-month integrated plan</h3>
            </div>
            <div className="overflow-x-auto border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-3">Period</th>
                    <th className="text-right px-3 py-3">Base demand</th>
                    <th className="text-right px-3 py-3">Production</th>
                    <th className="text-right px-3 py-3">RM purchase</th>
                    <th className="text-right px-3 py-3">RM ending inv.</th>
                    <th className="text-right px-3 py-3">Overtime</th>
                    <th className="text-right px-3 py-3">Capacity use</th>
                    <th className="text-right px-3 py-3">Campaigns</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {selected.monthly_plan.map((row) => (
                    <tr key={row.period} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono font-semibold text-slate-900">{row.period}</td>
                      <td className="px-3 py-3 text-right font-mono">{fmt(row.base_demand_tons)} t</td>
                      <td className="px-3 py-3 text-right font-mono font-semibold">{fmt(row.planned_production_tons)} t</td>
                      <td className="px-3 py-3 text-right font-mono">{fmt(row.raw_material_purchase_tons)} t</td>
                      <td className="px-3 py-3 text-right font-mono">{fmt(row.ending_raw_inventory_tons)} t</td>
                      <td className="px-3 py-3 text-right font-mono text-amber-700">{fmt(row.overtime_tons)} t</td>
                      <td className="px-3 py-3 text-right font-mono">{row.capacity_utilization_pct.toFixed(1)}%</td>
                      <td className="px-3 py-3 text-right font-mono">{row.active_campaigns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_1fr]">
            <div className="p-5 sm:p-6 xl:border-r border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 mb-4">
                <Boxes className="w-4 h-4 text-cyan-700" />
                <h3 className="text-sm font-bold text-slate-900">Plan by product grade</h3>
              </div>
              <div className="overflow-x-auto border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="text-left px-3 py-3">Grade</th>
                      <th className="text-right px-3 py-3">Demand</th>
                      <th className="text-right px-3 py-3">Production</th>
                      <th className="text-right px-3 py-3">End inventory</th>
                      <th className="text-right px-3 py-3">Expected short</th>
                      <th className="text-right px-3 py-3">Safety stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selected.product_plan.map((row) => (
                      <tr key={row.product} className="hover:bg-slate-50">
                        <td className="px-3 py-3 font-mono font-semibold text-slate-900">{row.product}</td>
                        <td className="px-3 py-3 text-right font-mono">{fmt(row.base_demand_tons)}</td>
                        <td className="px-3 py-3 text-right font-mono">{fmt(row.planned_production_tons)}</td>
                        <td className="px-3 py-3 text-right font-mono">{fmt(row.expected_ending_inventory_tons, 1)}</td>
                        <td className={`px-3 py-3 text-right font-mono ${row.expected_shortage_tons > 0 ? 'text-rose-700 font-semibold' : 'text-slate-400'}`}>
                          {fmt(row.expected_shortage_tons, 1)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono">{fmt(row.safety_stock_tons)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Scale className="w-4 h-4 text-cyan-700" />
                <h3 className="text-sm font-bold text-slate-900">Scenario outcomes</h3>
              </div>
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {selected.scenario_outcomes.map((scenario) => (
                  <div key={scenario.scenario} className="py-3 grid grid-cols-[1fr_auto] gap-3 items-center">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">{scenario.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {(scenario.probability * 100).toFixed(0)}% probability · {fmt(scenario.shortage_tons, 1)} t shortage
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-mono font-bold text-slate-900">{money(scenario.total_cost)}</div>
                      <div className={`text-[11px] font-semibold ${scenario.service_level_pct >= request.service_target_pct ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {scenario.service_level_pct.toFixed(1)}% service
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 bg-slate-50/70">
            <div className="p-5 sm:p-6 lg:border-r border-slate-200">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <h3 className="text-sm font-bold text-slate-900">Constraints represented</h3>
              </div>
              <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-2">
                {data.constraint_summary.map((item) => (
                  <li key={item} className="text-xs text-slate-600 flex items-start gap-2">
                    <span className="w-1.5 h-1.5 bg-emerald-600 mt-1.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-3">
                <Settings2 className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-bold text-slate-900">Confirm with company</h3>
              </div>
              <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-2">
                {data.assumptions_requiring_confirmation.map((item) => (
                  <li key={item} className="text-xs text-slate-600 flex items-start gap-2">
                    <span className="w-1.5 h-1.5 bg-amber-500 mt-1.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="min-w-0">
      <span className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="truncate">{label}</span>
        <span className="font-mono font-semibold text-slate-800 shrink-0">
          {value > 0 && suffix === '%' ? '+' : ''}{value}{suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full h-1.5 mt-3 bg-slate-200 appearance-none cursor-pointer accent-cyan-700"
      />
    </label>
  );
}

function Kpi({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <div className="p-5 sm:p-6 border-r border-b lg:border-b-0 even:border-r-0 lg:even:border-r last:border-r-0 border-slate-200 min-w-0">
      <div className="flex items-center justify-between gap-3 text-slate-500">
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
        <span className="text-cyan-700">{icon}</span>
      </div>
      <div className="text-xl sm:text-2xl font-black text-slate-900 font-mono mt-2 break-words">{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{detail}</div>
    </div>
  );
}
