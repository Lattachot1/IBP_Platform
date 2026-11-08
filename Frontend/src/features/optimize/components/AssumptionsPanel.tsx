import type { OptimizeResult } from '../types';

// Optimizer assumptions still to be confirmed
export function AssumptionsPanel({ view }: { view: OptimizeResult }) {
  return (
    <section className="opt-panel opt-assump" aria-label="Assumptions">
      <details className="opt-details" style={{ margin: 0 }}>
        <summary>Optimizer assumptions (pending confirmation from production)</summary>
        <ul>
          {view.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
