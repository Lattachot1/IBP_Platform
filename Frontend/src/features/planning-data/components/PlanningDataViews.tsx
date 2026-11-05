import { useState } from 'react';
import { RefreshCw, Table2 } from 'lucide-react';

import { formatNumber } from '@/lib/format';

import type { Product, SalesOrder } from '../types';
import type { PlanningViewsState } from '../usePlanningData';

type Tab = 'stock' | 'lots' | 'orders' | 'forecasts';
type OrderFilter = SalesOrder['status'] | 'all';

const th = 'py-2.5 px-3';
const td = 'py-2 px-3';

function Table({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode[]; empty: string }) {
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full text-left text-xs text-slate-700">
        <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px] sticky top-0">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {children.length ? children : (
            <tr><td colSpan={9} className="py-8 text-center text-slate-400">{empty}</td></tr>
          )}
        </tbody>
      </table>
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

// What the planning tables hold now: stock, lots in QC, sales orders, forecasts
export function PlanningDataViews({ views, products }: { views: PlanningViewsState; products: Product[] }) {
  const [tab, setTab] = useState<Tab>('stock');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('open');
  const product = new Map(products.map((p) => [p.material_no, p]));
  const orders = views.orders.filter((o) => orderFilter === 'all' || o.status === orderFilter);
  const stockRows = views.stock?.rows ?? [];

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'stock', label: 'Stock', count: stockRows.length },
    { id: 'lots', label: 'Lots in QC', count: views.lots.filter((l) => l.status === 'in_qc').length },
    { id: 'orders', label: 'Sales orders', count: views.orders.filter((o) => o.status === 'open').length },
    { id: 'forecasts', label: 'Forecast', count: views.forecasts.length },
  ];

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Table2 className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-800">Planning Data in the System</h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">What the optimizer plans from: released stock, lots still in QC, sales orders and the monthly forecast</p>
        </div>
        <button onClick={() => void views.refresh()} disabled={views.loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300">
          <RefreshCw className={`w-3.5 h-3.5 ${views.loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div role="tablist" className="flex gap-1 px-6 pt-4 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 -mb-px ${
              tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {t.label} <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{t.count}</span>
          </button>
        ))}
      </div>

      {views.error ? (
        <p role="alert" className="py-8 text-center text-xs text-rose-600">Could not load the planning data: {views.error}</p>
      ) : tab === 'stock' ? (
        <>
          <p className="px-6 pt-3 text-xs text-slate-500">
            {views.stock?.snapshot_date
              ? `Snapshot of ${views.stock.snapshot_date} · loaded by ${views.stock.loaded_by}`
              : 'No stock snapshot imported yet'}
          </p>
          <Table empty="No stock rows" head={
            <tr><th className={th}>Material</th><th className={th}>Description</th><th className={`${th} text-right`}>On hand (t)</th><th className={`${th} text-right`}>Min stock (t)</th></tr>
          }>
            {stockRows.map((r) => {
              const p = product.get(r.material_no);
              const below = p !== undefined && r.on_hand_tons < p.min_stock_tons;
              return (
                <tr key={r.material_no}>
                  <td className={`${td} font-mono font-semibold`}>{r.material_no}</td>
                  <td className={td}>{p?.description ?? '—'}</td>
                  <td className={`${td} text-right font-mono ${below ? 'text-rose-600 font-bold' : ''}`}>{formatNumber(r.on_hand_tons)}</td>
                  <td className={`${td} text-right font-mono text-slate-500`}>{p ? formatNumber(p.min_stock_tons) : '—'}</td>
                </tr>
              );
            })}
          </Table>
        </>
      ) : tab === 'lots' ? (
        <Table empty="No QC lots" head={
          <tr><th className={th}>Lot</th><th className={th}>Material</th><th className={`${th} text-right`}>Tons</th><th className={th}>Produced</th><th className={th}>Release</th><th className={th}>Status</th></tr>
        }>
          {views.lots.map((l) => (
            <tr key={l.lot_no}>
              <td className={`${td} font-mono`}>{l.lot_no}</td>
              <td className={`${td} font-mono font-semibold`}>{l.material_no}</td>
              <td className={`${td} text-right font-mono`}>{formatNumber(l.tons)}</td>
              <td className={td}>{l.produced_date}</td>
              <td className={td}>{l.release_date}</td>
              <td className={td}><Status value={l.status} /></td>
            </tr>
          ))}
        </Table>
      ) : tab === 'orders' ? (
        <>
          <div className="px-6 pt-3 text-xs flex items-center gap-2 text-slate-600">
            <span>Show</span>
            <select aria-label="Order status" value={orderFilter} onChange={(e) => setOrderFilter(e.target.value as OrderFilter)}
              className="px-2 py-1 rounded-md border border-slate-300">
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </select>
            <span className="text-slate-400">{orders.length} items · {formatNumber(Math.round(orders.reduce((s, o) => s + o.open_tons, 0)))} t still to ship</span>
          </div>
          <Table empty="No sales orders" head={
            <tr><th className={th}>Order / item</th><th className={th}>Material</th><th className={`${th} text-right`}>Ordered (t)</th><th className={`${th} text-right`}>Shipped (t)</th><th className={`${th} text-right`}>Open (t)</th><th className={th}>Due</th><th className={th}>Status</th></tr>
          }>
            {orders.map((o) => (
              <tr key={`${o.order_no}/${o.item_no}`}>
                <td className={`${td} font-mono`}>{o.order_no}/{o.item_no}</td>
                <td className={`${td} font-mono font-semibold`}>{o.material_no}</td>
                <td className={`${td} text-right font-mono`}>{formatNumber(o.tons)}</td>
                <td className={`${td} text-right font-mono`}>{formatNumber(o.shipped_tons)}</td>
                <td className={`${td} text-right font-mono font-semibold`}>{formatNumber(o.open_tons)}</td>
                <td className={td}>{o.due_date}</td>
                <td className={td}><Status value={o.status} /></td>
              </tr>
            ))}
          </Table>
        </>
      ) : (
        <Table empty="No forecast rows" head={
          <tr><th className={th}>Group</th><th className={th}>Month</th><th className={th}>Source</th><th className={`${th} text-right`}>Tons</th><th className={th}>Updated by</th></tr>
        }>
          {views.forecasts.map((f) => (
            <tr key={`${f.group_code}/${f.forecast_month}/${f.source}`}>
              <td className={`${td} font-semibold`}>{f.group_code}</td>
              <td className={td}>{f.forecast_month.slice(0, 7)}</td>
              <td className={td}>{f.source === 'manual' ? 'manual (overrides engine)' : 'engine'}</td>
              <td className={`${td} text-right font-mono`}>{formatNumber(f.tons)}</td>
              <td className={`${td} text-slate-400`}>{f.updated_by ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
