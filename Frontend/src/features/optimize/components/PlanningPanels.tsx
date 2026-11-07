import { useState } from 'react';
import Link from 'next/link';

import { formatNumber } from '@/lib/format';

import type { GradeMeta, OptimizeResult, PlannedOrder, PlannedProduct, PlanningSection } from '../types';

// Product-level results of a plan built from the planning data
// (use_planning_data): order status, projected stock, forecast coverage.

const STATUS_LABEL: Record<PlannedOrder['status'], string> = {
  on_time: 'On time',
  late: 'Late',
  not_covered: 'Not covered',
  after_horizon: 'After horizon',
};

const slotOf = (grades: GradeMeta[], group: string) => grades.find((g) => g.id === group)?.slot ?? 1;
const dispOf = (grades: GradeMeta[], group: string) => grades.find((g) => g.id === group)?.disp ?? group;

export function PlanningKpiStrip({ planning }: { planning: PlanningSection }) {
  const k = planning.kpis;
  const notOnTime = k.orders_late + k.orders_not_covered;
  return (
    <div className="opt-kpis" aria-label="Order and stock results">
      <div className="opt-tile">
        <div className="opt-lab">Orders on time</div>
        <div className={'opt-val' + (notOnTime ? ' bad' : '')}>
          {k.orders_on_time}<small> / {k.orders_in_horizon}</small>
        </div>
        <div className="opt-foot">{k.on_time_pct.toFixed(1)}% of orders · {k.on_time_tons_pct.toFixed(1)}% of tons</div>
      </div>
      <div className="opt-tile">
        <div className="opt-lab">Late</div>
        <div className="opt-val">{formatNumber(k.late_ton_days)} <small>ton-days</small></div>
        <div className="opt-foot">{k.orders_late} late · {k.orders_not_covered} not covered in the horizon</div>
      </div>
      <div className="opt-tile">
        <div className="opt-lab">Below minimum stock</div>
        <div className="opt-val">{formatNumber(k.below_min_ton_days)} <small>ton-days</small></div>
        <div className="opt-foot">Σ tons under the minimum × days</div>
      </div>
      <div className="opt-tile">
        <div className="opt-lab">Forecast short</div>
        <div className="opt-val">{formatNumber(k.forecast_short_tons)} <small>t</small></div>
        <div className="opt-foot">not-yet-ordered demand not produced by month end</div>
      </div>
      <div className="opt-tile">
        <div className="opt-lab">Stock snapshot</div>
        <div className="opt-val mono" style={{ fontSize: 18 }}>{planning.snapshot_date ?? 'none'}</div>
        <div className="opt-foot">output reaches stock {planning.qc_days} days after production (QC)</div>
      </div>
    </div>
  );
}

type OrderFilter = 'problems' | 'horizon' | 'after';

export function OrderStatusPanel({ planning }: { planning: PlanningSection }) {
  const names = Object.fromEntries(planning.products.map((p) => [p.material_no, p.description]));
  const problems = planning.orders.filter((o) => o.in_horizon && (o.status === 'late' || o.status === 'not_covered'));
  const [filter, setFilter] = useState<OrderFilter>(problems.length ? 'problems' : 'horizon');
  const rows =
    filter === 'problems' ? problems : planning.orders.filter((o) => (filter === 'horizon' ? o.in_horizon : !o.in_horizon));
  const filters: { id: OrderFilter; label: string; count: number }[] = [
    { id: 'problems', label: 'Not on time', count: problems.length },
    { id: 'horizon', label: 'All due in the horizon', count: planning.orders.filter((o) => o.in_horizon).length },
    { id: 'after', label: 'Due after the horizon', count: planning.orders.filter((o) => !o.in_horizon).length },
  ];

  return (
    <section className="opt-panel" aria-label="Order status">
      <h2 className="opt-ph">Sales orders — when each one can ship</h2>
      <div className="opt-segs" role="tablist">
        {filters.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id}
            className={'opt-segbtn' + (filter === f.id ? ' on' : '')} onClick={() => setFilter(f.id)}>
            {f.label} <span className="mono">{f.count}</span>
          </button>
        ))}
      </div>
      <div className="opt-twrap opt-scroll">
        <table className="opt-table">
          <thead>
            <tr>
              <th>Order / item</th>
              <th>Product</th>
              <th className="num">Open (t)</th>
              <th>Due</th>
              <th>Ready</th>
              <th className="num">Days late</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="opt-empty">{filter === 'problems' ? 'Every order due in the horizon ships on time' : 'No orders'}</td></tr>
            ) : (
              rows.map((o) => (
                <tr key={`${o.order_no}/${o.item_no}`}>
                  <td className="mono">{o.order_no}/{o.item_no}</td>
                  <td>{names[o.material_no] ?? o.material_no}</td>
                  <td className="mono num">{formatNumber(o.open_tons)}</td>
                  <td className="mono">{o.due_date}</td>
                  <td className="mono">{o.ready_date ?? '—'}</td>
                  <td className="mono num">{o.late_days ?? '—'}</td>
                  <td><span className={`opt-chip order-${o.status}`}>{STATUS_LABEL[o.status]}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="opt-railnote">
        Ready = first day the product&apos;s stock (snapshot + lots leaving QC + planned output after QC) covers the order,
        serving orders of the same product in due-date order.
      </p>
    </section>
  );
}

/** Daily projected stock as a small line chart, with the minimum as a dashed line. */
export function StockSpark({ product, color }: { product: PlannedProduct; color: string }) {
  const W = 220;
  const H = 34;
  const values = product.stock;
  const top = Math.max(1, product.min_stock, ...values) * 1.08;
  const bottom = Math.min(0, ...values);
  const y = (v: number) => H - ((v - bottom) / (top - bottom)) * H;
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W / 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="opt-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${product.description} stock from ${formatNumber(product.start_stock)} to ${formatNumber(product.end_stock)} t`}>
      {bottom < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="opt-spark-zero" />}
      {product.min_stock > 0 && <line x1={0} x2={W} y1={y(product.min_stock)} y2={y(product.min_stock)} className="opt-spark-min" />}
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.8} />
    </svg>
  );
}

export function StockProjectionPanel({ planning, grades }: { planning: PlanningSection; grades: GradeMeta[] }) {
  return (
    <section className="opt-panel" aria-label="Projected stock per product">
      <h2 className="opt-ph">Projected stock per product (available after shipments)</h2>
      <div className="opt-twrap">
        <table className="opt-table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Start</th>
              <th>Day by day (dashed = minimum)</th>
              <th className="num">End</th>
              <th className="num">Min</th>
              <th className="num">Days below min</th>
              <th className="num">Produced</th>
              <th className="num">Shipped</th>
            </tr>
          </thead>
          <tbody>
            {planning.products.map((p) => {
              const slot = slotOf(grades, p.group);
              return (
                <tr key={p.material_no}>
                  <td>
                    <span className="opt-gcode">
                      <i className="opt-dot" style={{ background: `var(--s${slot})` }} />
                      {p.description}
                    </span>
                    <div className="opt-subtle">{dispOf(grades, p.group)}</div>
                  </td>
                  <td className="mono num">{formatNumber(p.start_stock)}</td>
                  <td><StockSpark product={p} color={`var(--s${slot})`} /></td>
                  <td className={'mono num' + (p.end_stock < 0 ? ' opt-short' : '')}>{formatNumber(p.end_stock)}</td>
                  <td className="mono num">{formatNumber(p.min_stock)}</td>
                  <td className={'mono num' + (p.days_below_min ? ' opt-short' : '')}>{p.days_below_min}</td>
                  <td className="mono num">{formatNumber(p.produced.reduce((a, b) => a + b, 0))}</td>
                  <td className="mono num">{formatNumber(Math.round(p.shipped.reduce((a, b) => a + b, 0)))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="opt-railnote">
        Below zero = orders still waiting for stock. Output made in the last {planning.qc_days} days of the plan clears QC after the horizon.
      </p>
    </section>
  );
}

export function ForecastPanel({ planning, grades }: { planning: PlanningSection; grades: GradeMeta[] }) {
  if (planning.forecast.length === 0) {
    return (
      <section className="opt-panel" aria-label="Forecast coverage">
        <h2 className="opt-ph">Forecast still to produce</h2>
        <p className="opt-railnote">No forecast for the months of this plan — add one on the <Link href="/planning-data">Planning Data</Link> page.</p>
      </section>
    );
  }
  return (
    <section className="opt-panel" aria-label="Forecast coverage">
      <h2 className="opt-ph">Forecast still to produce (group × month)</h2>
      <div className="opt-twrap">
        <table className="opt-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Month</th>
              <th className="num">Forecast</th>
              <th className="num">Ordered</th>
              <th className="num">Not yet ordered</th>
              <th className="num">In this plan</th>
              <th>By</th>
              <th className="num">Short</th>
            </tr>
          </thead>
          <tbody>
            {planning.forecast.map((f) => (
              <tr key={`${f.group}/${f.month}`}>
                <td>
                  <span className="opt-gcode">
                    <i className="opt-dot" style={{ background: `var(--s${slotOf(grades, f.group)})` }} />
                    {dispOf(grades, f.group)}
                  </span>
                </td>
                <td className="mono">{f.month}{f.source === 'manual' ? ' · manual' : ''}</td>
                <td className="mono num">{formatNumber(f.forecast)}</td>
                <td className="mono num">{formatNumber(f.ordered)}</td>
                <td className="mono num">{formatNumber(f.not_yet_ordered)}</td>
                <td className="mono num">
                  {formatNumber(f.to_produce)}
                  {f.share_in_horizon < 1 && <span className="opt-subtle"> ({Math.round(f.share_in_horizon * 100)}%)</span>}
                </td>
                <td className="mono">{f.deadline}</td>
                <td className={'mono num' + (f.short_tons > 0 ? ' opt-short' : '')}>{formatNumber(f.short_tons)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="opt-railnote">
        Not yet ordered = forecast − every order due that month. It is shared over the group&apos;s products by their order share,
        and stock above each product&apos;s minimum counts against it. A month running past the plan counts only its days inside the plan.
      </p>
    </section>
  );
}

/** The product-level panels below the Gantt, or nothing for a plan made from tons per grade. */
export function PlanningPanels({ view, grades }: { view: OptimizeResult; grades: GradeMeta[] }) {
  const planning = view.planning;
  if (!planning) return null;
  return (
    <>
      <OrderStatusPanel planning={planning} />
      <StockProjectionPanel planning={planning} grades={grades} />
      <ForecastPanel planning={planning} grades={grades} />
    </>
  );
}
