'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  Cpu,
  RefreshCw,
  Package,
  AlertTriangle,
} from 'lucide-react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchForecast,
  fetchHistory,
  fetchModels,
  ForecastResponse,
  GradeModel,
  HistoryResponse,
} from '../lib/forecastApi';

interface ChartRow {
  period: string;
  actual: number | null;
  forecast: number | null;
  band: [number, number] | null;
}

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : Math.round(v).toLocaleString('en-US');

const HISTORY_MONTHS_SHOWN = 36;

export function DemandForecastPanel() {
  const [grades, setGrades] = useState<GradeModel[]>([]);
  const [productId, setProductId] = useState<string>('');
  const [horizon, setHorizon] = useState(3);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  // Load the champion leaderboard once to know which grades exist
  useEffect(() => {
    let cancelled = false;
    fetchModels()
      .then((res) => {
        if (cancelled) return;
        setGrades(res.models);
        setProductId(res.models[0]?.product_id ?? '');
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load history + forecast whenever the selection changes
  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchHistory(productId), fetchForecast(productId, horizon)])
      .then(([h, f]) => {
        if (cancelled) return;
        setHistory(h);
        setForecast(f);
        setOffline(false);
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, horizon]);

  const rows: ChartRow[] = useMemo(() => {
    if (!history || !forecast) return [];
    const out: ChartRow[] = history.months
      .slice(-HISTORY_MONTHS_SHOWN)
      .map((m) => ({ period: m.period, actual: m.tons, forecast: null, band: null }));
    // connector point so the forecast line continues from the actuals
    if (out.length) out[out.length - 1].forecast = out[out.length - 1].actual;
    forecast.periods.forEach((p, i) => {
      out.push({
        period: p,
        actual: null,
        forecast: forecast.forecast_tons[i],
        band: [forecast.lower_tons[i], forecast.upper_tons[i]],
      });
    });
    return out;
  }, [history, forecast]);

  const selectedGrade = grades.find((g) => g.product_id === productId);
  const isNaive = forecast?.model_name === 'SeasonalNaive(m=12)';

  if (offline) {
    return (
      <section className="bg-amber-50 rounded-2xl p-6 shadow-sm border border-amber-200 flex items-start gap-3.5">
        <div className="p-2 rounded-xl bg-amber-100 text-amber-600">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-base font-bold text-amber-900">AI Demand Forecast unavailable</h2>
          <p className="text-sm text-amber-800 mt-1">
            ไม่พบ Forecast Engine (Backend อาจยังไม่ได้รัน หรือไม่มีข้อมูล billing) —
            What-If Simulator ด้านบนยังใช้งานได้ตามปกติ
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-800">AI Demand Forecast</h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Real Billing Data
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            พยากรณ์ดีมานด์รายเดือน (ton) จากโมเดลจริงที่เทรนจากข้อมูล billing 89 เดือน ·
            กรอบคือ 80% interval ที่ขยายตามระยะทาง
          </p>
        </div>
        {forecast && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            trained through <span className="font-mono font-semibold text-slate-700">{forecast.trained_through}</span>
            {' · '}{forecast.model_name}
          </div>
        )}
      </div>

      <div className="p-6 space-y-5">
        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Product Grade</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-slate-50/50 text-sm"
            >
              {grades.map((g) => (
                <option key={g.product_id} value={g.product_id}>
                  {g.product_id} ({Math.round(g.avg_tons).toLocaleString('en-US')} t/mo)
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-slate-600">Forecast Horizon</label>
              <span className="text-xs font-bold font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                {horizon} เดือน
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mt-2.5"
            />
          </div>
        </div>

        {/* Chart */}
        <div className="relative h-72 rounded-xl border border-slate-200 bg-slate-50/50 p-2">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 rounded-xl">
              <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          )}
          {rows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="period"
                  minTickGap={48}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v: string) => v.replace('-', '/')}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
                  width={44}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (Array.isArray(value)) {
                      return [
                        `${fmt(Number(value[0]))} - ${fmt(Number(value[1]))} t`,
                        '80% Interval',
                      ];
                    }
                    const n = Number(value);
                    const label =
                      name === 'actual' ? 'Actual' : name === 'forecast' ? 'Forecast' : String(name);
                    return [`${fmt(Number.isFinite(n) ? n : null)} t`, label];
                  }}
                  labelStyle={{ fontWeight: 600 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Area
                  type="monotone"
                  dataKey="band"
                  name="band"
                  stroke="none"
                  fill="#3b82f6"
                  fillOpacity={0.12}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="actual"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name="forecast"
                  stroke="#059669"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls={true}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              Loading forecast...
            </div>
          )}
        </div>

        {/* Summary cards */}
        {forecast && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  Order Total ({horizon} mo)
                </span>
                <Package className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-slate-900 font-mono">
                  {fmt(forecast.total_forecast_tons)}
                </span>
                <span className="text-xs text-slate-500">ton</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                80% interval: {fmt(Math.min(...forecast.lower_tons))} – {fmt(Math.max(...forecast.upper_tons))} t
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider">Champion Model</span>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-sm font-bold text-slate-900">{forecast.model_name}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                {isNaive
                  ? 'ยังไม่มีโมเดลที่ชนะ benchmark จึงใช้ benchmark เป็น champion (กติกา MASE)'
                  : `ชนะ seasonal benchmark (MASE ${forecast.metrics.mase ?? '-'} < 1.0)`}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider">Accuracy (Backtest)</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  isNaive ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {selectedGrade?.champion === 'SeasonalNaive(m=12)' ? 'Benchmark' : 'Beats Naive'}
                </span>
              </div>
              <div className="text-sm font-mono text-slate-800">
                WAPE {forecast.metrics.wape !== null ? `${(forecast.metrics.wape * 100).toFixed(1)}%` : '-'}
                {' · '}MASE {forecast.metrics.mase ?? '-'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                rolling-origin backtest บนข้อมูลจริง · {forecast.interval.coverage_empirical !== null
                  ? `held-out coverage ${(forecast.interval.coverage_empirical * 100).toFixed(0)}%`
                  : ''}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
