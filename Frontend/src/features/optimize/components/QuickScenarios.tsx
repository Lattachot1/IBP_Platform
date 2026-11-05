import { buildRequest, PRESETS } from '../planForm';
import type { OptimizePlan } from '../useOptimizePlan';

// Quick scenario buttons: each resets the inputs and re-solves
export function QuickScenarios({ plan }: { plan: OptimizePlan }) {
  const { form, shown, solving, unapplied, applyAndRun } = plan;
  return (
    <div className="opt-presets" role="group" aria-label="Quick scenarios">
      <span className="opt-plab">Quick scenarios</span>
      {PRESETS.map((p) => {
        const next = p.apply(form);
        const active = !!shown && JSON.stringify(buildRequest(next)) === shown.key && !unapplied;
        return (
          <button
            key={p.id}
            type="button"
            className={'opt-preset' + (active ? ' active' : '')}
            title={p.hint}
            disabled={solving}
            onClick={() => applyAndRun(next)}
          >
            {p.label}
          </button>
        );
      })}
      <span className="opt-railnote" style={{ margin: 0 }}>
        Sets the inputs on the left and re-solves immediately · keeps your start date and holidays
      </span>
    </div>
  );
}
