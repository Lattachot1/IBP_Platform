import { useState } from 'react';
import { Package, Plus, RefreshCw } from 'lucide-react';

import { formatNumber } from '@/lib/format';

import type { Product, ProductGroup } from '../types';
import type { ProductMasterState } from '../usePlanningData';

const input = 'px-2 py-1 rounded-md border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const button = 'px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors disabled:opacity-50';

interface Draft {
  description: string;
  group_code: string;
  min_stock_tons: string;
}

const draftOf = (p: Product): Draft => ({
  description: p.description,
  group_code: p.group_code,
  min_stock_tons: String(p.min_stock_tons),
});

/** A minimum stock typed by the planner, or an error text. */
function parseMinimum(text: string): number | string {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value) || value < 0) return 'Minimum stock must be a number of tons, 0 or more';
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
    const minimum = parseMinimum(draft.min_stock_tons);
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

// Product master: every SAP material, its group and minimum stock
export function ProductMaster({ master }: { master: ProductMasterState }) {
  const [groupFilter, setGroupFilter] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rowError, setRowError] = useState<{ material: string; text: string } | null>(null);

  const groupName = (id: string) => master.groups.find((g) => g.id === id)?.disp ?? id;
  const shown = master.products.filter(
    (p) => (!groupFilter || p.group_code === groupFilter) && (showInactive || p.is_active),
  );
  const activeCount = master.products.filter((p) => p.is_active).length;

  const startEdit = (p: Product) => {
    setEditing(p.material_no);
    setDraft(draftOf(p));
    setRowError(null);
  };

  const saveEdit = async (p: Product) => {
    if (!draft) return;
    const minimum = parseMinimum(draft.min_stock_tons);
    if (typeof minimum === 'string') return setRowError({ material: p.material_no, text: minimum });
    const change = {
      ...(draft.description !== p.description && { description: draft.description }),
      ...(draft.group_code !== p.group_code && { group_code: draft.group_code }),
      ...(minimum !== p.min_stock_tons && { min_stock_tons: minimum }),
    };
    if (Object.keys(change).length === 0) return setEditing(null);
    const failure = await master.save(p.material_no, change);
    if (failure) setRowError({ material: p.material_no, text: failure });
    else setEditing(null);
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

      {adding && <AddProductForm master={master} onDone={() => setAdding(false)} />}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
            <tr>
              <th className="py-3 px-4">Material</th>
              <th className="py-3 px-4">Description</th>
              <th className="py-3 px-4">Group</th>
              <th className="py-3 px-4 text-right">Min stock (t)</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Last change</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {master.error ? (
              <tr><td colSpan={7} className="py-8 text-center text-rose-600">Could not load the product master: {master.error}</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">{master.loading ? 'Loading products…' : 'No products to show'}</td></tr>
            ) : (
              shown.map((p) => {
                const isEditing = editing === p.material_no && draft !== null;
                const saving = master.busy === p.material_no;
                return (
                  <tr key={p.material_no} className={p.is_active ? 'hover:bg-slate-50/80' : 'bg-slate-50 text-slate-400'}>
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
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-[11px] text-slate-400">
                      {p.updated_by} · {new Date(p.updated_at).toLocaleDateString('en-GB')}
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
