import { PRESETS } from '../planForm';
import type { OptimizePlan } from '../useOptimizePlan';

// Quick scenario buttons: each resets the inputs and re-solves
export function QuickScenarios({ plan }: { plan: OptimizePlan }) {
  const { activeScenario, solving, unapplied, applyScenario } = plan;
  return (
    <div className="opt-presets" role="group" aria-label="Quick scenarios">
      <span className="opt-plab">Quick scenarios</span>
      {PRESETS.map((p) => {
        const active = activeScenario === p.id && !unapplied;
        return (
          <button
            key={p.id}
            type="button"
            className={'opt-preset' + (active ? ' active' : '')}
            title={p.hint}
            disabled={solving}
            onClick={() => void applyScenario(p)}
          >
            {p.label}
          </button>
        );
      })}
      <span className="opt-railnote" style={{ margin: 0 }}>
        Sets demo demand per product at or above actual orders and runs a new plan. Keeps your start date and holidays.
      </span>
    </div>
  );
}
