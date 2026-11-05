import type { OptimizePlan } from '../useOptimizePlan';
import type { OptimizeResult } from '../types';

// Rule check results of the plan on screen
export function ConstraintChecks({ plan, view }: { plan: OptimizePlan; view: OptimizeResult }) {
  const { editing } = plan;
  return (
    <section className="opt-panel" aria-label="Constraint check results">
      <h2 className="opt-ph">Constraint check{editing ? ' — hand-edited plan' : ''}</h2>
      <ul className="opt-checks">
        {view.checks.map((c, i) => (
          <li key={i} className={c.level === 'conflict' ? 'conflict' : ''}>
            <span className={`opt-mk ${c.level}`}>{c.level === 'ok' ? '✓' : c.level === 'conflict' ? '✕' : '⚠'}</span>
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
