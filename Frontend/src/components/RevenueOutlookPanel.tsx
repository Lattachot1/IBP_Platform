'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Layers, RefreshCw } from 'lucide-react';
import { BdScenario, fetchRevenueOutlook, RevenueOutlookResponse } from '../lib/priceApi';

const MAX_HORIZON = 6;
const SCENARIO_OPTIONS: { value: BdScenario; label: string }[] = [
  { value: 'flat', label: 'Manual % (BD flat)' },
  { value: 'low', label: 'BD forecast P10 (low)' },
  { value: 'base', label: 'BD forecast P50 (base)' },
  { value: 'high', label: 'BD forecast P90 (high)' },
];

const fmt0 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : Math.round(v).toLocaleString('en-US');
const fmtM = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : `${(v / 1_000_000).toFixed(2)}M`;

export function RevenueOutlookPanel() {
  const [horizon, setHorizon] = useState(3);
  const [bdChangePct, setBdChangePct] = useState(0);
  const [demandChangePct, setDemandChangePct] = useState(0);
  const [bdScenario, setBdScenario] = useState<BdScenario>('flat');
  const [data, setData] = useState<RevenueOutlookResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchRevenueOutlook(horizon, bdChangePct, demandChangePct, bdScenario)
      .then((res) => {
        if (cancelled) return;
        setData(res);
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
  }, [horizon, bdChangePct, demandChangePct, bdScenario]);

  if (offline) {
    return (
      <section className="bg-amber-50 rounded-2xl p-6 shadow-sm border border-amber-200 flex items-start gap-3.5">
        <div className="p-2 rounded-xl bg-amber-100 text-amber-600">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-base font-bold text-amber-900">Revenue Outlook unavailable</h2>
          <p className="text-sm text-amber-800 mt-1">
            ต้องมีทั้ง Demand Engine และ Price Engine ทำงานพร้อมกัน (Backend + ข้อมูล billing และราคา BD)
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
            <Layers className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-800">Revenue Outlook</h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Demand × Price
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            รายได้ FOB ต่อ grade = ปริมาณจาก Demand Forecast (ตัน) × ราคาจาก Sale Price Forecast P50 (USD/ตัน)
          </p>
        </div>
        {data && (
          <div className="flex items-baseline gap-2 bg-slate-900 text-white rounded-xl px-4 py-2.5">
            <span className="text-xs text-slate-300 uppercase tracking-wider">Total {data.horizon_months} mo</span>
            <span className="text-2xl font-black font-mono">{fmtM(data.grand_total_revenue_usd)}</span>
            <span className="text-xs text-slate-300">USD · {fmt0(data.grand_total_tons)} t</span>
          </div>
        )}
      </div>

      <div className="p-6 space-y-5">
        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Horizon</label>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-slate-50/50 text-sm"
            >
              {Array.from({ length: MAX_HORIZON }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h} เดือน
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">BD scenario</label>
            <select
              value={bdScenario}
              onChange={(e) => setBdScenario(e.target.value as BdScenario)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-slate-50/50 text-sm"
            >
              {SCENARIO_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">BD price change (%)</label>
            <input
              type="number"
              min={-90}
              max={300}
              step={5}
              value={bdChangePct}
              disabled={bdScenario !== 'flat'}
              onChange={(e) => setBdChangePct(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono bg-slate-50/50 disabled:opacity-40"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Demand change (%)</label>
            <input
              type="number"
              min={-100}
              max={300}
              step={5}
              value={demandChangePct}
              onChange={(e) => setDemandChangePct(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono bg-slate-50/50"
            />
          </div>
        </div>

        {/* Table */}
        <div className="relative overflow-x-auto rounded-xl border border-slate-200">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
              <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          )}
          {data ? (
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Grade</th>
                  {data.periods.map((p) => (
                    <th key={p} className="py-2.5 px-3 text-right">
                      {p}
                      <div className="normal-case font-normal text-slate-400">tons · USD/t · USD</div>
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-right">Total USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.grades.map((g) => (
                  <tr key={g.product_id} className="hover:bg-slate-50/80">
                    <td className="py-2 px-3">
                      <div className="font-mono font-semibold text-slate-900">{g.product_id}</div>
                      <div className="text-[10px] text-slate-400">{g.total_tons.toLocaleString('en-US')} t</div>
                    </td>
                    {data.periods.map((p) => {
                      const m = g.months.find((x) => x.period === p);
                      return (
                        <td key={p} className="py-2 px-3 text-right font-mono">
                          {m ? (
                            <>
                              <div className="text-slate-500">{fmt0(m.tons)} t</div>
                              <div className="text-slate-500">{fmt0(m.price_usd_t)} $/t</div>
                              <div className="font-semibold text-slate-900">{fmt0(m.revenue_usd)}</div>
                            </>
                          ) : (
                            '-'
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{fmtM(g.total_revenue_usd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                <tr>
                  <td className="py-2.5 px-3">Total</td>
                  {data.totals.map((t) => (
                    <td key={t.period} className="py-2.5 px-3 text-right font-mono">
                      <div className="text-slate-500">{fmt0(t.tons)} t</div>
                      <div className="text-slate-900">{fmt0(t.revenue_usd)}</div>
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                    {fmtM(data.grand_total_revenue_usd)}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <div className="h-32 flex items-center justify-center text-sm text-slate-400">Loading outlook...</div>
          )}
        </div>

        {data && (
          <div className="text-[11px] text-slate-400">
            {data.basis} · BD: {data.bd_source}
            {data.skipped.length > 0 && ` · ไม่มี demand forecast สำหรับ: ${data.skipped.join(', ')}`}
          </div>
        )}
      </div>
    </section>
  );
}
