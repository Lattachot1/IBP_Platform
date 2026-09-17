'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Info, RefreshCw, TrendingUp } from 'lucide-react';
import {
  fetchRawMaterialForecast,
  fetchRawMaterialModels,
  RawMaterialForecastResponse,
  RawMaterialModelsResponse,
} from '../lib/rawmatApi';

const MAX_HORIZON = 6;

const fmt0 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : Math.round(v).toLocaleString('en-US');
const fmt1 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : v.toLocaleString(undefined, { maximumFractionDigits: 1 });

/**
 * Butadiene Price Outlook. The range-bar layout, header cells and the
 * disclaimer come from the original feature/butadiene-price-forecast
 * dashboard section; the horizon control and the backtest table are new.
 */
export function RawMaterialPanel() {
  const [horizon, setHorizon] = useState(4);
  const [forecast, setForecast] = useState<RawMaterialForecastResponse | null>(null);
  const [models, setModels] = useState<RawMaterialModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchRawMaterialForecast(horizon), fetchRawMaterialModels().catch(() => null)])
      .then(([f, m]) => {
        if (cancelled) return;
        setForecast(f);
        setModels(m);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [horizon, reloadKey]);

  const domain = forecast
    ? {
        min: Math.min(...forecast.forecasts.map((row) => row.p025)),
        max: Math.max(...forecast.forecasts.map((row) => row.p975)),
      }
    : null;
  const position = (value: number) => {
    if (!domain || domain.max === domain.min) return 0;
    return ((value - domain.min) / (domain.max - domain.min)) * 100;
  };

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-cyan-700" />
            <h2 className="text-lg font-bold text-slate-800">Butadiene Price Outlook</h2>
            <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
              Research prototype
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            FOB Southeast Asia purchasing scenarios · {horizon}-month planning horizon · ใช้เป็น scenario ของ Sale Price
            และ Revenue ด้านล่างได้
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-slate-50/50 text-xs"
            aria-label="Forecast horizon"
          >
            {Array.from({ length: MAX_HORIZON }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                {h} เดือน
              </option>
            ))}
          </select>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            title="Refresh raw-material forecast"
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh forecast</span>
          </button>
        </div>
      </div>

      {loading && !forecast ? (
        <div className="min-h-52 flex items-center justify-center text-sm text-slate-500">
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          Loading model artifact...
        </div>
      ) : error || !forecast ? (
        <div className="m-6 p-4 border border-rose-200 bg-rose-50 text-rose-800 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold">Raw-material forecast unavailable</div>
            <div className="text-xs mt-1 text-rose-700">{error ?? 'Backend ยังไม่ได้รัน หรือไม่มี artifact'}</div>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-200">
            <div className="p-4 sm:p-5 border-r border-b lg:border-b-0 border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">Market index</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{forecast.symbol}</div>
              <div className="text-xs text-slate-500">
                {forecast.market} · {forecast.unit}
              </div>
            </div>
            <div className="p-4 sm:p-5 lg:border-r border-b lg:border-b-0 border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">Selected model</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{forecast.model_name}</div>
              <div className="text-xs text-slate-500">
                MAE h1-4 {fmt1(forecast.validation_mae)} USD/t
                {forecast.naive_mae !== null && forecast.naive_mae !== undefined && ` · random walk ${fmt1(forecast.naive_mae)}`}
              </div>
            </div>
            <div className="p-4 sm:p-5 border-r border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">Data cutoff</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{forecast.forecast_origin}</div>
              <div className="text-xs text-slate-500">
                last {fmt0(forecast.last_value)} USD/t · {forecast.engine_source ?? 'artifact'}
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <div className="text-[10px] font-bold uppercase text-slate-500">Base next month</div>
              <div className="mt-1 text-sm font-mono font-bold text-cyan-800">{fmt1(forecast.forecasts[0].p50)}</div>
              <div className="text-xs text-slate-500">P50 · USD/t</div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-[72px_1fr] sm:grid-cols-[100px_1fr_280px] gap-x-4 gap-y-4 items-center">
              {forecast.forecasts.map((row) => {
                const left95 = position(row.p025);
                const right95 = position(row.p975);
                const left80 = position(row.p10);
                const right80 = position(row.p90);
                return (
                  <React.Fragment key={row.target_month}>
                    <div>
                      <div className="text-sm font-bold text-slate-800">
                        {new Date(`${row.target_month}T00:00:00Z`).toLocaleDateString('en-US', {
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'UTC',
                        })}
                      </div>
                      <div className="text-[10px] text-slate-400">Horizon {row.horizon}</div>
                    </div>
                    <div
                      className="relative h-8 bg-slate-100 rounded-md border border-slate-200"
                      title={`95% range ${row.p025.toFixed(0)}–${row.p975.toFixed(0)} USD/t`}
                    >
                      <div
                        className="absolute top-[14px] h-0.5 bg-slate-400"
                        style={{ left: `${left95}%`, width: `${right95 - left95}%` }}
                      />
                      <div
                        className="absolute top-2 h-4 bg-cyan-200 border border-cyan-500 rounded-sm"
                        style={{ left: `${left80}%`, width: `${Math.max(1, right80 - left80)}%` }}
                      />
                      <div
                        className="absolute top-1.5 w-1 h-5 bg-cyan-800 rounded-sm"
                        style={{ left: `calc(${position(row.p50)}% - 2px)` }}
                        title={`P50 ${row.p50.toFixed(1)} USD/t`}
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1 grid grid-cols-3 gap-2 text-right font-mono">
                      <div>
                        <div className="text-[10px] uppercase text-emerald-700">Low P10</div>
                        <div className="text-xs font-bold text-slate-800">{fmt1(row.p10)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-cyan-700">Base P50</div>
                        <div className="text-xs font-bold text-slate-800">{fmt1(row.p50)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-rose-700">High P90</div>
                        <div className="text-xs font-bold text-slate-800">{fmt1(row.p90)}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {models && models.models.length > 0 && (
            <div className="px-4 sm:px-6 pb-5">
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Backtest model</th>
                      <th className="py-2.5 px-3 text-right">MAE h1</th>
                      <th className="py-2.5 px-3 text-right">h2</th>
                      <th className="py-2.5 px-3 text-right">h3</th>
                      <th className="py-2.5 px-3 text-right">h4</th>
                      <th className="py-2.5 px-3 text-right">All</th>
                      <th className="py-2.5 px-3 text-right">Hold-out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {models.models.map((m) => (
                      <tr key={m.model} className={m.champion ? 'bg-cyan-50/60 font-semibold' : ''}>
                        <td className="py-2 px-3">
                          {m.model}
                          {m.champion && <span className="ml-2 text-[10px] uppercase text-cyan-700">champion</span>}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{fmt0(m.mae_h1)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt0(m.mae_h2)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt0(m.mae_h3)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt0(m.mae_h4)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt0(m.mae)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt0(m.mae_holdout)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
                  MAE หน่วย USD/t จาก rolling-origin backtest 18 folds × 4 เดือน · champion เลือกจาก folds ช่วงแรก hold-out คือ 4
                  folds สุดท้าย · coverage ของ P10-P90 บน hold-out{' '}
                  {models.interval?.coverage_p10_p90_holdout !== null && models.interval?.coverage_p10_p90_holdout !== undefined
                    ? `${(models.interval.coverage_p10_p90_holdout * 100).toFixed(0)}%`
                    : '-'}
                </div>
              </div>
            </div>
          )}

          <div className="px-4 sm:px-6 py-4 bg-amber-50 border-t border-amber-200 flex items-start gap-3">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-amber-900">
              P10/P50/P90 describe low, median, and high purchasing-price cases. Sales-price pass-through, freight, FX,
              and profit optimization are not included in this artifact. Prediction intervals are exploratory and are not
              procurement guarantees. {forecast.readiness}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
