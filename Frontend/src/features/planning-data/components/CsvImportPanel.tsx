import { AlertTriangle, CheckCircle2, FileUp, XCircle } from 'lucide-react';

import { formatNumber } from '@/lib/format';

import type { ImportKind, ImportReport } from '../types';
import type { CsvImportState } from '../usePlanningData';

interface KindInfo {
  kind: ImportKind;
  label: string;
  source: string;
  columns: string;
  rule: string;
}

export const IMPORT_KINDS: KindInfo[] = [
  {
    kind: 'stock',
    label: 'Stock',
    source: 'SAP stock list',
    columns: 'Material Number, Unrestricted · optional: Stock Date, SU, Storage Location',
    rule: 'Replaces the whole snapshot of its date; storage locations are added up',
  },
  {
    kind: 'qc-lots',
    label: 'Lots in QC',
    source: 'SAP inspection lots',
    columns: 'Inspection Lot, Material Number, Lot Qty, Production Date, Release Date · optional: Usage Decision (blank / A / R), SU',
    rule: 'Upserted by lot number',
  },
  {
    kind: 'sales-orders',
    label: 'Sales orders',
    source: 'SAP sales order items',
    columns: 'Sales Order Number, Sales Order Item, Material Number, Order Qty, Req. Delivery Date · optional: Delivered Qty, Status, SU',
    rule: 'Upserted by order + item; items not in the file stay as they are',
  },
  {
    kind: 'forecasts',
    label: 'Forecast',
    source: 'Monthly forecast per product group',
    columns: 'GroupCode, ForecastMonth (yyyy-mm), Tons · optional: Source (engine / manual, default manual)',
    rule: 'Upserted by group + month + source; manual overrides engine',
  },
];

const button = 'px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function Counts({ report }: { report: ImportReport }) {
  const parts = [`${formatNumber(report.rows_read)} rows read`, `${formatNumber(report.records)} records`];
  if (report.inserted !== undefined) parts.push(`${formatNumber(report.inserted)} new`);
  if (report.updated) parts.push(`${formatNumber(report.updated)} updated`);
  if (report.replaced) parts.push(`${formatNumber(report.replaced)} replaced`);
  if (report.snapshot_date) parts.push(`stock date ${report.snapshot_date}`);
  return <span>{parts.join(' · ')}</span>;
}

function ProblemTable({ title, items, total, tone }: {
  title: string; items: ImportReport['errors']; total: number; tone: 'error' | 'warning';
}) {
  if (total === 0) return null;
  return (
    <div className="mt-3">
      <p className={`text-xs font-semibold ${tone === 'error' ? 'text-rose-700' : 'text-amber-700'}`}>
        {title}{total > items.length ? ` (first ${items.length} of ${total})` : ` (${total})`}
      </p>
      <div className="mt-1.5 max-h-64 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider sticky top-0">
            <tr>
              <th className="py-2 px-3 w-16">Line</th>
              <th className="py-2 px-3 w-44">Column</th>
              <th className="py-2 px-3">Problem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((p, i) => (
              <tr key={i}>
                <td className="py-1.5 px-3 font-mono">{p.row ?? '—'}</td>
                <td className="py-1.5 px-3">{p.column ?? 'whole file'}</td>
                <td className="py-1.5 px-3">{p.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Upload a CSV: check it (dry run, nothing kept), then import the same file
export function CsvImportPanel({ imp }: { imp: CsvImportState }) {
  const info = IMPORT_KINDS.find((k) => k.kind === imp.kind) ?? IMPORT_KINDS[0];
  const { phase, report } = imp;

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <FileUp className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-bold text-slate-800">Import Planning Data (CSV)</h2>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          All or nothing: a file with any wrong line is rejected and nothing is saved. Check the file first, then import it.
        </p>
      </div>

      <div role="radiogroup" aria-label="File type" className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {IMPORT_KINDS.map((k) => (
          <button key={k.kind} role="radio" aria-checked={k.kind === imp.kind} onClick={() => imp.setKind(k.kind)}
            className={`text-left p-3 rounded-xl border text-xs transition-colors ${
              k.kind === imp.kind ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 hover:bg-slate-50'
            }`}>
            <div className="font-bold text-slate-800">{k.label}</div>
            <div className="text-slate-500">{k.source}</div>
          </button>
        ))}
      </div>

      <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
        <div><span className="font-semibold">Columns:</span> {info.columns}</div>
        <div><span className="font-semibold">Rule:</span> {info.rule}</div>
        <div className="text-slate-400">Quantities in tons (SU = TO; KG is converted) · dates yyyy/mm/dd, yyyy-mm-dd or dd.mm.yyyy · materials must be in the product master</div>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-slate-600">CSV file</span>
          <input aria-label="CSV file" type="file" accept=".csv,text/csv" className="text-xs"
            onChange={(e) => imp.setFile(e.target.files?.[0] ?? null)} />
        </label>
        {imp.kind === 'stock' && (
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-slate-600">Stock date (if the file has no Stock Date column)</span>
            <input aria-label="Stock date" type="date" value={imp.stockDate} onChange={(e) => imp.setStockDate(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-slate-300" />
          </label>
        )}
        <button className={`${button} bg-white border-slate-300 text-slate-700 hover:bg-slate-100`}
          disabled={!imp.canCheck} onClick={() => void imp.check()}>
          {phase === 'checking' ? 'Checking…' : 'Check file'}
        </button>
        <button className={`${button} bg-blue-600 border-blue-600 text-white hover:bg-blue-500`}
          disabled={!imp.canImport} onClick={() => void imp.commit()}>
          {phase === 'importing' ? 'Importing…' : 'Import'}
        </button>
      </div>

      {phase === 'checked' && report && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
          <div className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="w-4 h-4" /> File is valid — nothing saved yet</div>
          <div className="mt-1"><Counts report={report} /> · press Import to save it</div>
          <ProblemTable title="Warnings" items={report.warnings} total={report.warning_count} tone="warning" />
        </div>
      )}
      {phase === 'imported' && report && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
          <div className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="w-4 h-4" /> Imported</div>
          <div className="mt-1"><Counts report={report} /></div>
          <ProblemTable title="Warnings" items={report.warnings} total={report.warning_count} tone="warning" />
        </div>
      )}
      {phase === 'rejected' && report && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <div className="flex items-center gap-1.5 font-semibold"><XCircle className="w-4 h-4" /> {imp.message}</div>
          <ProblemTable title="Errors" items={report.errors} total={report.error_count} tone="error" />
          <ProblemTable title="Warnings" items={report.warnings} total={report.warning_count} tone="warning" />
        </div>
      )}
      {phase === 'failed' && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> Could not reach the import: {imp.message}
        </div>
      )}
    </section>
  );
}
