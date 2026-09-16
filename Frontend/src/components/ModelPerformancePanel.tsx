'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { fetchModels, GradeModel, ModelsResponse } from '../lib/forecastApi';

const NAIVE = 'SeasonalNaive(m=12)';

export function ModelPerformancePanel() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchModels()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (offline || !data) return null;

  const maxWape = Math.max(...data.models.map((m) => m.wape ?? 0), 0.01);

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-800">Model Performance</h2>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Verified on Real Data
          </span>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          ผลการแข่งขันจริงจาก rolling-origin backtest (16 folds × 3 เดือน) —
          โมเดลที่ชนะ naive เท่านั้นที่ได้เป็น champion · MASE &lt; 1.0 = ชนะ seasonal benchmark
        </p>
      </div>

      <div className="p-6 space-y-4">
        {data.models.map((m: GradeModel) => {
          const isNaive = m.champion === NAIVE;
          return (
            <div key={m.product_id} className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="sm:w-56 shrink-0">
                <div className="text-sm font-bold text-slate-800 font-mono">{m.product_id}</div>
                <div className="text-[11px] text-slate-400">
                  {m.months} เดือน · {Math.round(m.avg_tons).toLocaleString('en-US')} t/mo
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isNaive ? 'bg-slate-400' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, ((m.wape ?? 0) / maxWape) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono font-semibold text-slate-700 w-12 text-right">
                    {m.wape !== null ? `${(m.wape * 100).toFixed(1)}%` : '-'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  MASE {m.mase ?? '-'} · {m.champion}
                </div>
              </div>

              <span
                className={`shrink-0 inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                  isNaive
                    ? 'bg-slate-50 text-slate-600 border-slate-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
              >
                {isNaive ? 'ใช้ Benchmark' : 'ชนะ Benchmark'}
              </span>
            </div>
          );
        })}

        <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-start gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            WAPE = ค่าความคลาดเคลื่อนเฉลี่ยถ่วงน้ำหนัก (ยิ่งต่ำยิ่งแม่น) ·
            coverage ที่แสดงเป็นค่า held-out จากตัวอย่างที่จำกัด · เทรนล่าสุด{' '}
            {new Date(data.trained_at).toLocaleString()}
          </span>
        </div>
      </div>
    </section>
  );
}
