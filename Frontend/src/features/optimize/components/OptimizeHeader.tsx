import type { OptimizePlan } from '../useOptimizePlan';

// Page title row with the run / edit / offline status badges (nav lives in AppHeader)
export function OptimizeHeader({ plan }: { plan: OptimizePlan }) {
  const { data, phase, manual, offline, editing, conflicts } = plan;
  return (
    <header className="opt-header">
      <div className="opt-title">
        <h1>Production Optimization</h1>
        <div className="opt-sub">
          UBE IBP Platform · TSL — daily production plan for 6 product groups under grade-change, reactor-lifecycle and holiday rules
        </div>
      </div>
      <div className="opt-badges">
        {editing && (
          <span className={'opt-badge ' + (conflicts ? 'conflict' : 'edit')}>
            <span className="opt-led" />
            {manual?.checking ? 'Editing · checking rules…' : conflicts ? `Editing · ${conflicts} rule conflict${conflicts === 1 ? '' : 's'}` : 'Editing · no rule conflicts'}
          </span>
        )}
        {phase === 'ok' && data && !editing && (
          <span className="opt-badge live">
            <span className="opt-led" />
            {data.mode === 'sample' ? 'Engine stub · sample plan' : `Solver: ${data.mode}`}
            {' · '}
            {data.kpis.solve_s.toFixed(2)} s
          </span>
        )}
        {offline && (
          <span className="opt-badge warn">
            <span className="opt-led" />
            Offline — using the built-in sample plan
          </span>
        )}
        {phase === 'stale' && (
          <span className="opt-badge warn">
            <span className="opt-led" />
            Backend is an older version — restart python main.py, then press Run optimization
          </span>
        )}
        {phase === 'sample' && (
          <span className="opt-badge">Sample plan — press Run optimization to solve</span>
        )}
      </div>
    </header>
  );
}
