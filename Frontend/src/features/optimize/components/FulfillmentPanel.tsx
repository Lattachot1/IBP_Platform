import { formatNumber } from '@/lib/format';
import type { OptimizeResult } from '../types';

// Produced vs demand per grade
export function FulfillmentPanel({ view }: { view: OptimizeResult }) {
  return (
    <section className="opt-panel" aria-label="Demand fulfillment">
      <h2 className="opt-ph">
        {view.planning
          ? 'Output by group vs net requirement (orders + minimum stock + forecast − stock and lots in QC)'
          : 'Fulfillment by grade (produced vs demand in the horizon)'}
      </h2>
      {view.fulfillment.map((r) => {
        const pct = r.demand > 0 ? Math.min(r.produced / r.demand, 1) * 100 : 0;
        return (
          <div className="opt-frow" key={r.grade}>
            <span className="opt-gcode">
              <i className="opt-dot" style={{ background: `var(--s${r.slot})` }} />
              {r.disp}
            </span>
            <div className="opt-ftrack">
              <div
                className="opt-ffill"
                style={{ width: `${pct.toFixed(1)}%`, background: `var(--s${r.slot})` }}
              />
            </div>
            <span className="opt-fmeta">
              {formatNumber(r.produced)} / {formatNumber(r.demand)} t ·{' '}
              {r.shortage > 0
                ? <span className="opt-short">short {formatNumber(r.shortage)}</span>
                : `+${formatNumber(r.produced - r.demand)}`}
            </span>
          </div>
        );
      })}
    </section>
  );
}
