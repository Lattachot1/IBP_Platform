import type { TipState } from '../useOptimizePlan';

// Hover tooltip of a Gantt cell
export function PlanTooltip({ tip }: { tip: TipState }) {
  return (
    <div className="opt-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.lines.map((l, i) =>
        i === 0 ? <b key={i}>{l}</b> : <div key={i}>{l}</div>
      )}
    </div>
  );
}
