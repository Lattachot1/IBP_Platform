import type { OptimizeResult } from '../types';

// Optimizer assumptions still to be confirmed
export function AssumptionsPanel({ view }: { view: OptimizeResult }) {
  return (
    <section className="opt-panel opt-assump" aria-label="Assumptions">
      <b>Optimizer assumptions (pending confirmation from production)</b>
      <ul>
        {view.assumptions.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </section>
  );
}
