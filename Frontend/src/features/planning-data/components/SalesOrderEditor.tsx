import { useState, type FormEvent } from 'react';

import type { SalesOrder, SalesOrderChange } from '../types';
import type { PlanningViewsState } from '../usePlanningData';

const field = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-700';

export function SalesOrderEditor({ order, save, close }: {
  order: SalesOrder;
  save: PlanningViewsState['saveSalesOrder'];
  close: () => void;
}) {
  const [tons, setTons] = useState(String(order.tons));
  const [due, setDue] = useState(order.due_date);
  const [status, setStatus] = useState(order.status);
  const [shipTo, setShipTo] = useState(order.ship_to ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const ordered = Number(tons);
    if (!Number.isFinite(ordered) || ordered <= 0 || ordered < order.shipped_tons) {
      setError(`Order quantity must be positive and at least the ${order.shipped_tons} t already shipped.`);
      return;
    }
    const changes: SalesOrderChange = {};
    if (ordered !== order.tons) changes.tons = ordered;
    if (due !== order.due_date) changes.due_date = due;
    if (status !== order.status) changes.status = status;
    const partner = shipTo.trim() || null;
    if (partner !== order.ship_to) changes.ship_to = partner;
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }

    setError(null);
    setSaving(true);
    const failure = await save(order.order_no, order.item_no, changes);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    close();
  }

  return (
    <form className="mt-2 rounded-lg border border-sky-200 bg-sky-50/40 p-3 text-xs" onSubmit={(event) => void submit(event)}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">Edit sales order {order.order_no}/{order.item_no}</h3>
        <span className="text-slate-500">{order.shipped_tons} t already shipped</span>
      </div>
      <fieldset className="grid grid-cols-2 gap-2 lg:grid-cols-4" disabled={saving}>
        <label>Ordered (t)
          <input className={field} type="number" min={Math.max(0.001, order.shipped_tons)} step="0.001"
            required value={tons} onChange={(event) => setTons(event.target.value)} />
        </label>
        <label>Due date
          <input className={field} type="date" required value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
        <label>Status
          <select className={field} value={status} onChange={(event) => setStatus(event.target.value as SalesOrder['status'])}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label>Ship-to code
          <input className={field} maxLength={20} value={shipTo} onChange={(event) => setShipTo(event.target.value)} />
        </label>
      </fieldset>
      {error && <p className="mt-2 text-rose-700" role="alert">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={close}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={saving}
          className="rounded-md bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-800 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save order'}
        </button>
      </div>
    </form>
  );
}
