import { formatNumber, signed } from '@/lib/format';
import type { OptimizePlan } from '../useOptimizePlan';
import type { OptimizeResult } from '../types';

// KPI tiles (with deltas vs the optimized plan while editing)
export function KpiStrip({ plan, view }: { plan: OptimizePlan; view: OptimizeResult }) {
  const { manual, editing, conflicts } = plan;

  function kpiDelta(key: 'total_tons' | 'fulfillment_pct' | 'shortage_tons' | 'changeover_days', higherIsBetter: boolean, suffix = '') {
    if (!manual || !manual.baseEval || !manual.result) return null;
    const diff = manual.result.kpis[key] - manual.baseEval.kpis[key];
    if (Math.abs(diff) < 1e-9) return <div className="opt-delta same">= optimized plan</div>;
    const good = higherIsBetter ? diff > 0 : diff < 0;
    return (
      <div className={'opt-delta ' + (good ? 'good' : 'bad')}>
        {signed(diff, key === 'fulfillment_pct' ? 1 : 0)}{suffix} vs optimized
      </div>
    );
  }

  return (
    <div className="opt-kpis">
      <div className="opt-tile">
        <div className="opt-lab">Total production</div>
        <div className="opt-val">{formatNumber(view.kpis.total_tons)} <small>t</small></div>
        <div className="opt-foot">{view.horizon_days} days · avg {formatNumber(Math.round(view.kpis.total_tons / Math.max(1, view.horizon_days)))} t/day</div>
        {kpiDelta('total_tons', true, ' t')}
      </div>
      <div className="opt-tile">
        <div className="opt-lab">Fulfillment</div>
        <div className="opt-val">{view.kpis.fulfillment_pct.toFixed(1)}<small>%</small></div>
        <div className="opt-foot">Σ min(produced, demand) / Σ demand</div>
        {kpiDelta('fulfillment_pct', true, ' pp')}
      </div>
      <div className="opt-tile">
        <div className="opt-lab">Shortage</div>
        <div className="opt-val">{formatNumber(view.kpis.shortage_tons)} <small>t</small></div>
        <div className="opt-foot">Σ max(demand − produced, 0) over all grades</div>
        {kpiDelta('shortage_tons', false, ' t')}
      </div>
      <div className="opt-tile">
        <div className="opt-lab">Changeover days</div>
        <div className="opt-val">{view.kpis.changeover_days} <small>days</small></div>
        <div className="opt-foot">per the 11-pair transition table</div>
        {kpiDelta('changeover_days', false, ' d')}
      </div>
      <div className="opt-tile">
        <div className="opt-lab">{editing ? 'Rule check' : 'Solver'}</div>
        {editing ? (
          <div className={'opt-val' + (conflicts ? ' bad' : '')}>{conflicts} <small>conflict{conflicts === 1 ? '' : 's'}</small></div>
        ) : (
          <div className="opt-val">{view.kpis.solve_s.toFixed(2)} <small>s</small></div>
        )}
        <div className="opt-foot">{view.kpis.status} · mode: {view.mode}</div>
      </div>
    </div>
  );
}
