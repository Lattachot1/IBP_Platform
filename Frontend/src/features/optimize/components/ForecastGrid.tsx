// The planner's hand-set monthly forecast, shown on the /optimize page in
// planning-data mode: the effective number per group and month (a hand-set
// manual row, else the engine's / Sale forecast's), editable in place. A
// change is saved to the planning data (PUT /api/v1/forecasts/{group}/{month})
// as a 'manual' row that overrides every source and survives reloads; ×
// clears it back. A set may never go below the month's actual order tons:
// orders keep their own due dates, the part above them is demand without
// one, produced within the month.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { deleteJson, describeFailure, getJson, putJson } from '@/lib/apiClient';
import { formatNumber } from '@/lib/format';
import type { ProductGroup } from '@/features/planning-data/types';

export interface ForecastCell {
  group_code: string;
  month: string;                    // ISO first-of-month
  tons: number | null;              // effective: manual ?? engine
  source: 'manual' | 'engine' | null;
  updated_by: string | null;
  ordered_tons: number;             // the floor a hand set may not go below
}

const cellKey = (group: string, month: string) => `${group}|${month}`;
const monthParam = (month: string) => month.slice(0, 7);      // '2026-11-01' -> '2026-11'

export function ForecastGrid({ startMonth, months, grades }: {
  startMonth: string;                          // 'YYYY-MM-01'
  months: number;
  grades: ProductGroup[];
}) {
  const [cells, setCells] = useState<ForecastCell[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await getJson<ForecastCell[]>(
        `/api/v1/forecast-grid?start_month=${startMonth}&months=${months}`);
      setCells(rows);
      setError(null);
      setDrafts({});
      setCellErrors({});
    } catch (err) {
      setError(describeFailure(err));
    }
  }, [startMonth, months]);

  useEffect(() => { void load(); }, [load]);

  const monthList = useMemo(
    () => (cells ? Array.from(new Set(cells.map((c) => c.month))) : []),
    [cells],
  );
  const disp = (group: string) => grades.find((g) => g.id === group)?.disp ?? group;

  const setDraft = (key: string, value: string) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    setCellErrors((e) => ({ ...e, [key]: '' }));
  };

  const save = async (cell: ForecastCell) => {
    const key = cellKey(cell.group_code, cell.month);
    const raw = drafts[key];
    if (raw === undefined || raw.trim() === '') return;
    const tons = Number(raw);
    if (!Number.isFinite(tons) || tons < 0) {
      setCellErrors((e) => ({ ...e, [key]: 'Tons must be 0 or more' }));
      return;
    }
    if (tons < cell.ordered_tons - 1e-9) {
      setCellErrors((e) => ({ ...e, [key]: `Cannot go below ${formatNumber(cell.ordered_tons)} t — the month's actual orders` }));
      return;
    }
    setBusy(key);
    try {
      const saved = await putJson<{ tons: number; updated_by: string | null }>(
        `/api/v1/forecasts/${encodeURIComponent(cell.group_code)}/${monthParam(cell.month)}`,
        { tons },
      );
      setCells((list) => list?.map((c) => (
        c.group_code === cell.group_code && c.month === cell.month
          ? { ...c, tons: saved.tons, source: 'manual', updated_by: saved.updated_by }
          : c
      )) ?? list);
      setCellErrors((e) => ({ ...e, [key]: '' }));
    } catch (err) {
      setCellErrors((e) => ({ ...e, [key]: describeFailure(err) }));
    } finally {
      setBusy(null);
    }
  };

  const clear = async (cell: ForecastCell) => {
    const key = cellKey(cell.group_code, cell.month);
    setBusy(key);
    try {
      await deleteJson(`/api/v1/forecasts/${encodeURIComponent(cell.group_code)}/${monthParam(cell.month)}/manual`);
      await load();
    } catch (err) {
      setCellErrors((e) => ({ ...e, [key]: describeFailure(err) }));
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return <p role="alert" className="opt-railnote text-rose-600">Could not load the forecast: {error}</p>;
  }
  if (!cells) {
    return <p className="opt-railnote">Loading the forecast…</p>;
  }

  return (
    <div className="mt-2">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-[11px] text-slate-700">
          <thead className="bg-slate-50 text-slate-400 font-semibold">
            <tr>
              <th className="py-1.5 px-2">Forecast (t)</th>
              {monthList.map((m) => (
                <th key={m} className="py-1.5 px-2 text-right whitespace-nowrap">
                  {`${m.slice(5, 7)}/${m.slice(0, 4)}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cells
              .filter((c, i, list) => list.findIndex((x) => x.group_code === c.group_code) === i)
              .map((row) => (
                <tr key={row.group_code}>
                  <td className="py-1 px-2 font-semibold whitespace-nowrap">{disp(row.group_code)}</td>
                  {monthList.map((m) => {
                    const cell = cells.find((c) => c.group_code === row.group_code && c.month === m)!;
                    const key = cellKey(cell.group_code, cell.month);
                    const handSet = cell.source === 'manual';
                    const value = drafts[key] ?? (cell.tons === null ? '' : String(cell.tons));
                    return (
                      <td key={m} className="py-1 px-2 text-right whitespace-nowrap">
                        <input
                          aria-label={`Forecast ${disp(cell.group_code)} ${monthParam(cell.month)}`}
                          className={`w-20 rounded border px-1.5 py-0.5 text-right font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            cellErrors[key] ? 'border-rose-400 bg-rose-50' : handSet ? 'border-sky-300 font-bold text-sky-700' : 'border-slate-300'
                          }`}
                          inputMode="decimal"
                          placeholder="—"
                          title={handSet ? 'Hand-set: overrides the engine and the Sale forecast' : 'From the planning data (engine / Sale forecast)'}
                          value={value}
                          onChange={(e) => setDraft(key, e.target.value)}
                          onBlur={() => void save(cell)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void save(cell); }}
                        />
                        {handSet && (
                          <button
                            type="button"
                            className="ml-1 text-slate-400 hover:text-rose-600"
                            aria-label={`Clear hand-set forecast ${disp(cell.group_code)} ${monthParam(cell.month)}`}
                            title="Clear the hand-set value: the engine / Sale forecast shows through again"
                            disabled={busy === key}
                            onClick={() => void clear(cell)}
                          >
                            ×
                          </button>
                        )}
                        {cellErrors[key] && (
                          <p role="alert" className="mt-0.5 max-w-[9rem] text-right text-[10px] leading-tight text-rose-600">
                            {cellErrors[key]}
                          </p>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="opt-railnote">
        Edit a cell and it is saved to the <Link href="/planning-data">Planning Data</Link> page as a hand-set
        forecast that overrides the engine and the Sale forecast (bold = hand-set, × clears it). It can never go
        below the month&apos;s actual orders — orders keep their due dates, the part above them is demand without
        one, produced within that month.
      </p>
    </div>
  );
}
