'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, DollarSign, Info, RefreshCw, TrendingUp } from 'lucide-react';
import {
  Area,
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
  BdScenario,
  fetchPriceForecast,
  fetchPriceHistory,
  fetchPriceModels,
  PriceForecastResponse,
  PriceHistoryResponse,
  PriceModelRow,
} from '../lib/priceApi';

interface ChartRow {
  period: string;
  actual: number | null;
  bd: number | null;
  bdScenario: number | null;
  forecast: number | null;
  band: [number, number] | null;
}

const HISTORY_MONTHS_SHOWN = 36;
const MAX_HORIZON = 6;
const BD_PRESETS: { label: string; pct: number }[] = [
  { label: 'BD -15%', pct: -15 },
  { label: 'BD flat', pct: 0 },
  { label: 'BD +15%', pct: 15 },
];
// Source of the BD path: a manual percentage, or the butadiene forecast quantiles
const SCENARIO_OPTIONS: { value: BdScenario; label: string; short: string }[] = [
  { value: 'flat', label: 'Manual %', short: 'manual' },
  { value: 'low', label: 'BD forecast P10', short: 'P10 low' },
  { value: 'base', label: 'P50', short: 'P50 base' },
  { value: 'high', label: 'P90', short: 'P90 high' },
];

const fmt0 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : Math.round(v).toLocaleString('en-US');
const pct1 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : `${(v * 100).toFixed(1)}%`;

export function SalePricePanel() {
  const [grades, setGrades] = useState<PriceModelRow[]>([]);
  const [bdLastMonth, setBdLastMonth] = useState<string | null>(null);
  const [productId, setProductId] = useState<string>('');
  const [horizon, setHorizon] = useState(3);
  const [bdChangePct, setBdChangePct] = useState(0);
  const [bdScenario, setBdScenario] = useState<BdScenario>('flat');
  const [history, setHistory] = useState<PriceHistoryResponse | null>(null);
  const [forecast, setForecast] = useState<PriceForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  // Leaderboard once: which grades exist and how each champion scored
  useEffect(() => {
    let cancelled = false;
    fetchPriceModels()
      .then((res) => {
        if (cancelled) return;
        setGrades(res.models);
        setBdLastMonth(res.bd_last_month);
        setProductId(res.models[0]?.product_id ?? '');
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // History + forecast whenever the selection or the BD scenario changes
  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchPriceHistory(productId), fetchPriceForecast(productId, horizon, bdChangePct, bdScenario)])
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
  }, [productId, horizon, bdChangePct, bdScenario]);

  const rows: ChartRow[] = useMemo(() => {
    if (!history || !forecast) return [];
    const out: ChartRow[] = history.months.slice(-HISTORY_MONTHS_SHOWN).map((m) => ({
      period: m.period,
      actual: m.fob_price,
      bd: m.bd,
      bdScenario: null,
      forecast: null,
      band: null,
    }));
    if (out.length) {
      // connector points so the dashed lines continue from the actuals
      out[out.length - 1].forecast = out[out.length - 1].actual;
      out[out.length - 1].bdScenario = out[out.length - 1].bd;
    }
    forecast.periods.forEach((p, i) => {
      out.push({
        period: p,
        actual: null,
        bd: null,
        bdScenario: forecast.bd_path[i],
        forecast: forecast.forecast[i],
        band: [forecast.lower[i], forecast.upper[i]],
      });
    });
    return out;
  }, [history, forecast]);

  const selected = grades.find((g) => g.product_id === productId);

  if (offline) {
    return (
      <section className="bg-amber-50 rounded-2xl p-6 shadow-sm border border-amber-200 flex items-start gap-3.5">
        <div className="p-2 rounded-xl bg-amber-100 text-amber-600">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-base font-bold text-amber-900">Sale Price Forecast unavailable</h2>
          <p className="text-sm text-amber-800 mt-1">
            ไม่พบ Price Engine (Backend อาจยังไม่ได้รัน หรือยังไม่มีข้อมูล billing / ราคา BD) —
            ส่วนอื่นของ Dashboard ยังใช้งานได้ตามปกติ
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
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-800">Sale Price Forecast</h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Real Billing + BD Data
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            ราคาขาย FOB รายเดือน (USD/ตัน) ต่อ grade จากโมเดลที่ผูกกับราคา butadiene ย้อนหลัง 1-2 เดือน ·
            กรอบคือ 80% interval ที่ขยายตามระยะทาง
          </p>
        </div>
        {forecast && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            trained through <span className="font-mono font-semibold text-slate-700">{forecast.trained_through}</span>
            {' · '}
            {forecast.model_name}
          </div>
        )}
      </div>

      <div className="p-6 space-y-5">
        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Product Grade</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50/50 text-sm"
            >
              {grades.map((g) => (
                <option key={g.product_id} value={g.product_id}>
                  {g.product_id} ({fmt0(g.last_price)} USD/t)
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-slate-600">Forecast Horizon</label>
              <span className="text-xs font-bold font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                {horizon} เดือน
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={MAX_HORIZON}
              step={1}
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600 mt-2.5"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-slate-600">BD Price Scenario (from month 2)</label>
              <span
                className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                  bdScenario !== 'flat'
                    ? 'bg-cyan-100 text-cyan-800'
                    : bdChangePct > 0
                    ? 'bg-rose-100 text-rose-700'
                    : bdChangePct < 0
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {bdScenario !== 'flat'
                  ? `forecast ${SCENARIO_OPTIONS.find((s) => s.value === bdScenario)?.short ?? bdScenario}`
                  : bdChangePct > 0
                  ? `+${bdChangePct}%`
                  : `${bdChangePct}%`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
              {SCENARIO_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setBdScenario(s.value)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    bdScenario === s.value
                      ? 'bg-cyan-700 text-white border-cyan-700'
                      : 'bg-white hover:bg-cyan-50 text-cyan-800 border-cyan-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className={`flex items-center gap-1.5 ${bdScenario !== 'flat' ? 'opacity-40 pointer-events-none' : ''}`}>
              {BD_PRESETS.map((s) => (
                <button
                  key={s.pct}
                  onClick={() => setBdChangePct(s.pct)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    bdChangePct === s.pct
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <input
                type="number"
                min={-90}
                max={300}
                step={5}
                value={bdChangePct}
                onChange={(e) => setBdChangePct(Number(e.target.value))}
                className="w-20 px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-slate-50/50"
                aria-label="BD change percent"
              />
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="relative h-80 rounded-xl border border-slate-200 bg-slate-50/50 p-2">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 rounded-xl">
              <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin" />
            </div>
          )}
          {rows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="period"
                  minTickGap={48}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v: string) => v.replace('-', '/')}
                />
                <YAxis
                  yAxisId="price"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
                  width={44}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  yAxisId="bd"
                  orientation="right"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
                  width={44}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (Array.isArray(value)) {
                      return [`${fmt0(Number(value[0]))} - ${fmt0(Number(value[1]))} USD/t`, '80% Interval'];
                    }
                    const n = Number(value);
                    const label =
                      name === 'actual'
                        ? 'FOB price'
                        : name === 'forecast'
                        ? 'Forecast'
                        : name === 'bd'
                        ? 'BD (actual)'
                        : name === 'bdScenario'
                        ? 'BD (scenario)'
                        : String(name);
                    return [`${fmt0(Number.isFinite(n) ? n : null)} USD/t`, label];
                  }}
                  labelStyle={{ fontWeight: 600 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value: string) =>
                    value === 'actual'
                      ? 'FOB price (USD/t)'
                      : value === 'forecast'
                      ? 'Forecast'
                      : value === 'bd'
                      ? 'Butadiene (right axis)'
                      : value === 'bdScenario'
                      ? 'BD scenario'
                      : value === 'band'
                      ? '80% interval'
                      : value
                  }
                />
                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="band"
                  name="band"
                  stroke="none"
                  fill="#10b981"
                  fillOpacity={0.14}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="bd"
                  type="monotone"
                  dataKey="bd"
                  name="bd"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="bd"
                  type="monotone"
                  dataKey="bdScenario"
                  name="bdScenario"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls={true}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="price"
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
                  yAxisId="price"
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
            <div className="h-full flex items-center justify-center text-sm text-slate-400">Loading forecast...</div>
          )}
        </div>

        {/* Summary cards */}
        {forecast && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider">Next month ({forecast.periods[0]})</span>
                <DollarSign className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-slate-900 font-mono">{fmt0(forecast.forecast[0])}</span>
                <span className="text-xs text-slate-500">USD/t</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                80% interval: {fmt0(forecast.lower[0])} – {fmt0(forecast.upper[0])} · last actual {fmt0(history?.last_price)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider">Champion Model</span>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-sm font-bold text-slate-900">{forecast.model_name}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                MAPE {pct1(forecast.metrics.mape)} (hold-out {pct1(forecast.metrics.mape_holdout)}) · naive{' '}
                {pct1(forecast.metrics.naive_mape)} · coverage {pct1(forecast.interval.coverage_empirical)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider">BD Assumption</span>
                <Info className="w-4 h-4 text-slate-500" />
              </div>
              <div className="text-sm font-mono font-bold text-slate-900">
                {fmt0(forecast.bd_last)} → {fmt0(forecast.bd_path[Math.min(1, forecast.bd_path.length - 1)])} USD/t
              </div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                last BD {bdLastMonth ?? forecast.bd_last_month ?? '-'} · {forecast.bd_source} · เดือนแรกใช้ BD จริงล่าสุด
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard */}
        {grades.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Grade</th>
                  <th className="py-2.5 px-3">Champion</th>
                  <th className="py-2.5 px-3 text-right">MAPE</th>
                  <th className="py-2.5 px-3 text-right">Hold-out</th>
                  <th className="py-2.5 px-3 text-right">Naive</th>
                  <th className="py-2.5 px-3 text-right">h1 / h2 / h3</th>
                  <th className="py-2.5 px-3 text-right">80% coverage</th>
                  <th className="py-2.5 px-3 text-right">Last price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grades.map((g) => (
                  <tr key={g.product_id} className={g.product_id === productId ? 'bg-emerald-50/50' : ''}>
                    <td className="py-2 px-3 font-mono font-semibold">{g.product_id}</td>
                    <td className="py-2 px-3">{g.champion}</td>
                    <td className="py-2 px-3 text-right font-mono">{pct1(g.mape)}</td>
                    <td className="py-2 px-3 text-right font-mono">{pct1(g.mape_holdout)}</td>
                    <td className="py-2 px-3 text-right font-mono text-slate-400">{pct1(g.naive_mape)}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {pct1(g.mape_h1)} / {pct1(g.mape_h2)} / {pct1(g.mape_h3)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{pct1(g.coverage_empirical)}</td>
                    <td className="py-2 px-3 text-right font-mono">{fmt0(g.last_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
              rolling-origin backtest {selected?.folds ?? 16} folds × 3 เดือน · champion เลือกจาก folds ช่วงแรก ส่วน hold-out คือ{' '}
              {selected?.holdout_folds ?? 4} folds สุดท้ายที่ไม่ได้ใช้เลือก (ครอบคลุมช่วงราคาพุ่งปี 2026) · BD ในการ backtest ถูกตรึงที่ค่าล่าสุดเสมอ
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
