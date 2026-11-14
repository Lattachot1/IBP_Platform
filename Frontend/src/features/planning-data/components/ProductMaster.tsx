import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Package, Plus, RefreshCw, Sparkles } from 'lucide-react';

import { describeFailure } from '@/lib/apiClient';
import { formatNumber } from '@/lib/format';

import { publishEngineForecast } from '../api';
import type { Product, ProductGroup } from '../types';
import type { PlanningViewsState, ProductMasterState } from '../usePlanningData';

const input = 'px-2 py-1 rounded-md border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const button = 'px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors disabled:opacity-50';
const th = 'py-2 px-3';
const td = 'py-1.5 px-3';

interface Draft {
  description: string;
  group_code: string;
  min_stock_tons: string;
  adjust_tons: string;   // '' = no hand adjustment (the imported value is used)
}

const draftOf = (p: Product, adjust: number | null): Draft => ({
  description: p.description,
  group_code: p.group_code,
  min_stock_tons: String(p.min_stock_tons),
  adjust_tons: adjust === null ? '' : String(adjust),
});

/** Tons typed by the planner (minimum stock, stock adjustment), or an error text. */
function parseTons(text: string, label: string): number | string {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value) || value < 0) return `${label} must be a number of tons, 0 or more`;
  return value;
}

function GroupSelect({ groups, value, onChange, label }: {
  groups: ProductGroup[]; value: string; onChange: (v: string) => void; label: string;
}) {
  return (
    <select aria-label={label} className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>{g.disp}</option>
      ))}
    </select>
  );
}

function AddProductForm({ master, onDone }: { master: ProductMasterState; onDone: () => void }) {
  const [draft, setDraft] = useState({ material_no: '', description: '', group_code: master.groups[0]?.id ?? '', min_stock_tons: '0' });
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const minimum = parseTons(draft.min_stock_tons, 'Minimum stock');
    if (typeof minimum === 'string') return setError(minimum);
    if (!draft.material_no.trim() || !draft.description.trim()) return setError('Material number and description are required');
    const failure = await master.add({ ...draft, min_stock_tons: minimum });
    if (failure) setError(failure);
    else onDone();
  };

  return (
    <div className="px-6 py-4 bg-blue-50/60 border-b border-blue-100 flex flex-wrap items-end gap-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-slate-600">Material number</span>
        <input className={input} value={draft.material_no} onChange={(e) => setDraft({ ...draft, material_no: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
        <span className="font-semibold text-slate-600">Description</span>
        <input className={input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-slate-600">Group</span>
        <GroupSelect label="New product group" groups={master.groups} value={draft.group_code}
          onChange={(v) => setDraft({ ...draft, group_code: v })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-slate-600">Min stock (t)</span>
        <input className={`${input} w-24 text-right`} inputMode="decimal" value={draft.min_stock_tons}
          onChange={(e) => setDraft({ ...draft, min_stock_tons: e.target.value })} />
      </label>
      <button className={`${button} bg-blue-600 border-blue-600 text-white hover:bg-blue-500`}
        disabled={master.busy === 'new'} onClick={submit}>
        {master.busy === 'new' ? 'Adding…' : 'Add product'}
      </button>
      <button className={`${button} bg-white border-slate-300 text-slate-600 hover:bg-slate-100`} onClick={onDone}>Cancel</button>
      {error && <p role="alert" className="w-full text-rose-600">{error}</p>}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  in_qc: 'bg-amber-50 text-amber-700',
  released: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  open: 'bg-blue-50 text-blue-700',
  closed: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-rose-50 text-rose-600',
};

function Status({ value }: { value: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLE[value] ?? ''}`}>{value.replace('_', ' ')}</span>;
}

/** The planning inputs of one product, summed from the imported data. */
function figuresOf(p: Product, views: PlanningViewsState) {
  const base = views.stock?.rows.find((r) => r.material_no === p.material_no)?.on_hand_tons ?? null;
  const adjust = views.stock?.adjustments.find((a) => a.material_no === p.material_no)?.adjust_tons ?? null;
  const onHand = adjust ?? base;   // what the plan actually starts from
  const inQcTons = views.lots.filter((l) => l.material_no === p.material_no && l.status === 'in_qc').reduce((s, l) => s + l.tons, 0);
  const open = views.orders.filter((o) => o.material_no === p.material_no && o.status === 'open');
  const openTons = open.reduce((s, o) => s + o.open_tons, 0);
  const nextDue = open.length ? open.map((o) => o.due_date).sort()[0] : null;
  return { base, adjust, onHand, inQcTons, openTons, nextDue };
}

/** A small table inside an expanded row; scrollable so long lists stay compact. */
function MiniTable({ caption, head, children, empty }: {
  caption: string; head: React.ReactNode; children: React.ReactNode[]; empty: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
      <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{caption}</div>
      <div className="max-h-48 overflow-auto">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="text-slate-400 font-semibold border-b border-slate-100 text-[11px]">
            {head}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {children.length ? children : <tr><td className={`${td} text-slate-400`}>{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The expanded row: this product's QC lots, sales orders and its group's forecast. */
function DetailRow({ p, master, views }: { p: Product; master: ProductMasterState; views: PlanningViewsState }) {
  const lots = views.lots.filter((l) => l.material_no === p.material_no);
  const orders = views.orders.filter((o) => o.material_no === p.material_no);
  const forecasts = views.forecasts.filter((f) => f.group_code === p.group_code);
  const groupDisp = master.groups.find((g) => g.id === p.group_code)?.disp ?? p.group_code;
  return (
    <tr className="bg-slate-50/60">
      <td colSpan={11} className="py-3 px-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <MiniTable caption="QC lots" empty="No QC lots for this product" head={
            <tr><th className={th}>Lot</th><th className={`${th} text-right`}>Tons</th><th className={th}>Produced</th><th className={th}>Release</th><th className={th}>Status</th></tr>
          }>
            {lots.map((l) => (
              <tr key={l.lot_no}>
                <td className={`${td} font-mono`}>{l.lot_no}</td>
                <td className={`${td} text-right font-mono`}>{formatNumber(l.tons)}</td>
                <td className={td}>{l.produced_date}</td>
                <td className={td}>{l.release_date}</td>
                <td className={td}><Status value={l.status} /></td>
              </tr>
            ))}
          </MiniTable>
          <MiniTable caption="Sales orders" empty="No sales orders for this product" head={
            <tr><th className={th}>Order / item</th><th className={`${th} text-right`}>Ordered (t)</th><th className={`${th} text-right`}>Open (t)</th><th className={th}>Due</th><th className={th}>Status</th></tr>
          }>
            {orders.map((o) => (
              <tr key={`${o.order_no}/${o.item_no}`}>
                <td className={`${td} font-mono`}>{o.order_no}/{o.item_no}</td>
                <td className={`${td} text-right font-mono`}>{formatNumber(o.tons)}</td>
                <td className={`${td} text-right font-mono font-semibold`}>{formatNumber(o.open_tons)}</td>
                <td className={td}>{o.due_date}</td>
                <td className={td}><Status value={o.status} /></td>
              </tr>
            ))}
          </MiniTable>
          <MiniTable caption={`Group forecast — ${groupDisp} (monthly)`} empty="No forecast rows for this group" head={
            <tr><th className={th}>Month</th><th className={th}>Source</th><th className={`${th} text-right`}>Tons</th><th className={th}>Updated by</th></tr>
          }>
            {forecasts.map((f) => (
              <tr key={`${f.forecast_month}/${f.source}`}>
                <td className={`${td} font-mono`}>{f.forecast_month.slice(0, 7)}</td>
                <td className={td}>{f.source === 'manual' ? 'manual (overrides engine)' : 'engine'}</td>
                <td className={`${td} text-right font-mono`}>{formatNumber(f.tons)}</td>
                <td className={`${td} text-slate-400`}>{f.updated_by ?? '—'}</td>
              </tr>
            ))}
          </MiniTable>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Last change: {p.updated_by} · {new Date(p.updated_at).toLocaleDateString('en-GB')}
        </p>
      </td>
    </tr>
  );
}

// Product master: every SAP material with its group, minimum stock and the
// planning inputs (stock, QC lots, open orders) that the plan is built from.
export function ProductMaster({ master, views }: { master: ProductMasterState; views: PlanningViewsState }) {
  const [groupFilter, setGroupFilter] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rowError, setRowError] = useState<{ material: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [engineNote, setEngineNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Writes the forecast engine's monthly group forecast as engine rows
  const updateFromEngine = async () => {
    setPublishing(true);
    try {
      const r = await publishEngineForecast();
      setEngineNote({
        ok: true,
        text: `${r.rows} engine rows for ${r.groups.join(', ')} (${r.first_month} to ${r.last_month}) · ${r.inserted} new, ${r.updated} updated`
          + (r.skipped_grades.length ? ` · not a plant group: ${r.skipped_grades.join(', ')}` : ''),
      });
      await views.refresh();
    } catch (err) {
      setEngineNote({ ok: false, text: describeFailure(err) });
    } finally {
      setPublishing(false);
    }
  };

  const groupName = (id: string) => master.groups.find((g) => g.id === id)?.disp ?? id;
  const shown = master.products.filter(
    (p) => (!groupFilter || p.group_code === groupFilter) && (showInactive || p.is_active),
  );
  const activeCount = master.products.filter((p) => p.is_active).length;
  const adjustmentCount = views.stock?.adjustments.length ?? 0;

  const startEdit = (p: Product) => {
    setEditing(p.material_no);
    // the adjust box pre-fills with the current adjustment ('' = none); it
    // works with or without an imported snapshot
    setDraft(draftOf(p, figuresOf(p, views).adjust));
    setRowError(null);
  };

  const saveEdit = async (p: Product) => {
    if (!draft) return;
    const minimum = parseTons(draft.min_stock_tons, 'Minimum stock');
    if (typeof minimum === 'string') return setRowError({ material: p.material_no, text: minimum });
    const adjust = figuresOf(p, views).adjust;
    let tons: number | null = null;
    if (draft.adjust_tons.trim() !== '') {
      const parsed = parseTons(draft.adjust_tons, 'Stock adjust');
      if (typeof parsed === 'string') return setRowError({ material: p.material_no, text: parsed });
      tons = parsed;
    }
    const change = {
      ...(draft.description !== p.description && { description: draft.description }),
      ...(draft.group_code !== p.group_code && { group_code: draft.group_code }),
      ...(minimum !== p.min_stock_tons && { min_stock_tons: minimum }),
    };
    if (Object.keys(change).length > 0) {
      const failure = await master.save(p.material_no, change);
      if (failure) return setRowError({ material: p.material_no, text: failure });
    }
    // the hand-entered stock wins over the import; empty clears it back
    if (tons !== adjust) {
      const failure = await views.setStockAdjustment(p.material_no, tons);
      if (failure) return setRowError({ material: p.material_no, text: failure });
    }
    setEditing(null);
  };

  const toggleActive = async (p: Product) => {
    const failure = await master.save(p.material_no, { is_active: !p.is_active });
    setRowError(failure ? { material: p.material_no, text: failure } : null);
  };

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-800">Product Master</h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {activeCount} active of {master.products.length} products · plant rules stay on the product group ·
            a product that is no longer sold is deactivated, never deleted
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {views.loading
              ? 'Loading planning data…'
              : `Stock is ${views.stock?.snapshot_date ? `the snapshot of ${views.stock.snapshot_date}` : 'not imported yet'} · a Stock adjust value wins over it (enter one when the system data is not in yet)${adjustmentCount ? ` · ${adjustmentCount} hand adjustment${adjustmentCount === 1 ? '' : 's'} active` : ''} · ${views.lots.filter((l) => l.status === 'in_qc').length} lots in QC · ${views.orders.filter((o) => o.status === 'open').length} open orders · expand a row for its details`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select aria-label="Filter by group" className={input} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">All groups</option>
            {master.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.disp}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <button className={`${button} bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 inline-flex items-center gap-1`}
            onClick={() => void updateFromEngine()} disabled={publishing} title="Publish the forecast engine's monthly group forecast as engine rows (manual rows keep overriding them)">
            <Sparkles className={`w-3.5 h-3.5 ${publishing ? 'animate-pulse' : ''}`} />
            {publishing ? 'Updating…' : 'Update from forecast engine'}
          </button>
          <button className={`${button} bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-1`}
            onClick={() => void master.refresh()} disabled={master.loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${master.loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button className={`${button} bg-blue-600 border-blue-600 text-white hover:bg-blue-500 inline-flex items-center gap-1`}
            onClick={() => setAdding(true)} disabled={adding || master.groups.length === 0}>
            <Plus className="w-3.5 h-3.5" /> Add product
          </button>
        </div>
      </div>

      {engineNote && (
        <p role={engineNote.ok ? 'status' : 'alert'} className={`px-6 py-2 text-xs border-b border-slate-200 ${engineNote.ok ? 'text-emerald-700 bg-emerald-50/50' : 'text-rose-600 bg-rose-50/50'}`}>
          {engineNote.ok ? engineNote.text : `Could not update from the forecast engine: ${engineNote.text}`}
        </p>
      )}
      {views.error && (
        <p role="alert" className="px-6 py-2 text-xs text-rose-600 bg-rose-50/50 border-b border-slate-200">
          Could not load the planning data: {views.error}
        </p>
      )}

      {adding && <AddProductForm master={master} onDone={() => setAdding(false)} />}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
            <tr>
              <th className="py-3 px-3"><span className="sr-only">Details</span></th>
              <th className="py-3 px-4">Material</th>
              <th className="py-3 px-4">Description</th>
              <th className="py-3 px-4">Group</th>
              <th className="py-3 px-4 text-right">Min stock (t)</th>
              <th className="py-3 px-4 text-right">Stock (t)</th>
              <th className="py-3 px-4 text-right">Stock adjust (t)</th>
              <th className="py-3 px-4 text-right">In QC (t)</th>
              <th className="py-3 px-4 text-right">Open orders (t)</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {master.error ? (
              <tr><td colSpan={11} className="py-8 text-center text-rose-600">Could not load the product master: {master.error}</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={11} className="py-8 text-center text-slate-400">{master.loading ? 'Loading products…' : 'No products to show'}</td></tr>
            ) : (
              shown.map((p) => {
                const isEditing = editing === p.material_no && draft !== null;
                const saving = master.busy === p.material_no;
                const fig = figuresOf(p, views);
                const short = fig.onHand !== null && fig.onHand < p.min_stock_tons;
                const isExpanded = expanded === p.material_no;
                return (
                  <Fragment key={p.material_no}>
                    <tr className={p.is_active ? 'hover:bg-slate-50/80' : 'bg-slate-50 text-slate-400'}>
                      <td className="py-2.5 px-3 text-center">
                        <button aria-expanded={isExpanded} aria-label={`Details of ${p.material_no}`}
                          className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          onClick={() => setExpanded(isExpanded ? null : p.material_no)}>
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold">{p.material_no}</td>
                      <td className="py-2.5 px-4">
                        {isEditing ? (
                          <input aria-label={`Description of ${p.material_no}`} className={`${input} w-full`} value={draft.description}
                            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                        ) : p.description}
                        {rowError?.material === p.material_no && <p role="alert" className="text-rose-600 mt-1">{rowError.text}</p>}
                      </td>
                      <td className="py-2.5 px-4">
                        {isEditing ? (
                          <GroupSelect label={`Group of ${p.material_no}`} groups={master.groups} value={draft.group_code}
                            onChange={(v) => setDraft({ ...draft, group_code: v })} />
                        ) : groupName(p.group_code)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        {isEditing ? (
                          <input aria-label={`Minimum stock of ${p.material_no}`} className={`${input} w-24 text-right`} inputMode="decimal"
                            value={draft.min_stock_tons} onChange={(e) => setDraft({ ...draft, min_stock_tons: e.target.value })} />
                        ) : formatNumber(p.min_stock_tons)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        {views.loading ? '…' : fig.base === null ? '—' : (
                          <span className={fig.adjust === null && short ? 'text-rose-600 font-bold' : ''}>
                            {formatNumber(fig.base)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        {isEditing ? (
                          <input aria-label={`Stock adjust of ${p.material_no}`} className={`${input} w-24 text-right`} inputMode="decimal"
                            placeholder="—"
                            title="Hand-entered stock: the plan uses this instead of the Stock column (clear it to fall back)"
                            value={draft.adjust_tons} onChange={(e) => setDraft({ ...draft, adjust_tons: e.target.value })} />
                        ) : views.loading ? '…' : fig.adjust === null ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span title="Hand-entered stock: the plan uses this instead of the Stock column (Edit the row and clear it to fall back)"
                            className={short ? 'text-rose-600 font-bold' : 'font-bold text-sky-700'}>
                            {formatNumber(fig.adjust)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        {views.loading ? '…' : fig.inQcTons === 0 ? '—' : formatNumber(fig.inQcTons)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {views.loading ? '…' : fig.openTons === 0 ? '—' : (
                          <>
                            <span className="font-mono">{formatNumber(fig.openTons)}</span>
                            <span className="block text-[10px] text-slate-400">next due {fig.nextDue}</span>
                          </>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-1.5">
                        {isEditing ? (
                          <>
                            <button className={`${button} bg-blue-600 border-blue-600 text-white hover:bg-blue-500`} disabled={saving}
                              onClick={() => void saveEdit(p)}>{saving ? 'Saving…' : 'Save'}</button>
                            <button className={`${button} bg-white border-slate-300 text-slate-600 hover:bg-slate-100`}
                              onClick={() => setEditing(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className={`${button} bg-white border-slate-300 text-slate-700 hover:bg-slate-100`}
                              onClick={() => startEdit(p)} disabled={saving}>Edit</button>
                            <button className={`${button} bg-white ${p.is_active ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                              onClick={() => void toggleActive(p)} disabled={saving}>
                              {p.is_active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {isExpanded && <DetailRow p={p} master={master} views={views} />}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
