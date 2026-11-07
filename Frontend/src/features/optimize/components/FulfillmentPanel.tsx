import { Fragment } from 'react';

import { formatNumber } from '@/lib/format';
import type { OptimizeResult } from '../types';

function Bar({ produced, demand, slot }: { produced: number; demand: number; slot: number }) {
  const pct = demand > 0 ? Math.min(produced / demand, 1) * 100 : 0;
  return (
    <div className="opt-ftrack">
      <div className="opt-ffill" style={{ width: `${pct.toFixed(1)}%`, background: `var(--s${slot})` }} />
    </div>
  );
}

function Meta({ produced, demand, shortage }: { produced: number; demand: number; shortage: number }) {
  return (
    <span className="opt-fmeta">
      {formatNumber(produced)} / {formatNumber(demand)} t ·{' '}
      {shortage > 0
        ? <span className="opt-short">short {formatNumber(shortage)}</span>
        : `+${formatNumber(Math.round((produced - demand) * 10) / 10)}`}
    </span>
  );
}

// Produced vs demand per grade, with the products a group was broken into
export function FulfillmentPanel({ view }: { view: OptimizeResult }) {
  const products = view.product_fulfillment ?? [];
  return (
    <section className="opt-panel" aria-label="Demand fulfillment">
      <h2 className="opt-ph">
        {view.planning
          ? 'Output by group vs net requirement (orders + minimum stock + forecast − stock and lots in QC)'
          : 'Fulfillment by grade (produced vs demand in the horizon)'}
      </h2>
      {view.fulfillment.map((r) => (
        <Fragment key={r.grade}>
          <div className="opt-frow">
            <span className="opt-gcode">
              <i className="opt-dot" style={{ background: `var(--s${r.slot})` }} />
              {r.disp}
            </span>
            <Bar produced={r.produced} demand={r.demand} slot={r.slot} />
            <Meta produced={r.produced} demand={r.demand} shortage={r.shortage} />
          </div>
          {products.filter((p) => p.group === r.grade).map((p) => (
            <div className="opt-frow opt-prodfrow" key={p.material_no}>
              <span className="opt-gcode opt-pname" title={p.description}>{p.description}</span>
              <Bar produced={p.produced} demand={p.demand} slot={r.slot} />
              <Meta produced={p.produced} demand={p.demand} shortage={p.shortage} />
            </div>
          ))}
        </Fragment>
      ))}
      {products.length > 0 && (
        <p className="opt-railnote">
          A group&apos;s output is shared over its products in proportion to their demand, so every product of a group reaches the same fulfillment %.
        </p>
      )}
    </section>
  );
}
