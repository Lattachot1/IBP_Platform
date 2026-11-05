import { dispOf } from '../samplePlan';
import type { OptimizePlan } from '../useOptimizePlan';
import type { OptimizeResult } from '../types';

// Plan title, status chips and the problem / offline alerts
export function StageHeader({ plan, view }: { plan: OptimizePlan; view: OptimizeResult }) {
  const { form, shown, solving, problem, manual, unapplied, showProblem, applyAndRun, offline, grades, hasPlan, editing, conflicts, fixes } = plan;
  return (
    <>
      <div className="opt-stagehead">
        <h1>{view.horizon_days}-Day Production Plan</h1>
        <span className="opt-title">
          <span className={'opt-sub' + (unapplied && !editing ? ' old' : '')}>
            {view.start_date} · starts from {dispOf(shown?.form.initGrade ?? form.initGrade, grades)} ·{' '}
            {editing ? 'hand-edited plan (optimized plan shown as ghost)' : offline ? 'built-in sample data' : 'live backend result'}
            {view.planning && !editing ? ' · planned per product from the planning data' : ''}
          </span>
        </span>
        {unapplied && !editing && <span className="opt-chip stale">Result for previous inputs</span>}
        {editing && (
          <span className={'opt-chip ' + (conflicts ? 'conflict' : 'okay')}>
            {manual?.checking ? 'Checking rules…' : conflicts ? `${conflicts} rule conflict${conflicts === 1 ? '' : 's'}` : 'No rule conflicts'}
          </span>
        )}
      </div>

      {showProblem && problem && !editing && (
        <div className={'opt-alert' + (problem.status === 'error' ? ' error' : '')} role="alert">
          <h2>
            {problem.status === 'infeasible' && 'No plan satisfies every rule for these inputs'}
            {problem.status === 'unknown' && 'The solver ran out of time before finding a plan'}
            {problem.status === 'error' && 'The optimizer request failed'}
          </h2>
          <p>{problem.message}</p>
          {hasPlan && problem.status !== 'error' && (
            <p>The previous plan stays on screen below for reference.</p>
          )}
          {fixes.length > 0 && (
            <div className="opt-actions">
              {fixes.map((fx) => (
                <button
                  key={fx.label}
                  type="button"
                  className="opt-fixbtn"
                  disabled={solving}
                  onClick={() => applyAndRun(fx.next)}
                >
                  {fx.label}
                </button>
              ))}
              <span className="opt-railnote" style={{ margin: 0, alignSelf: 'center' }}>each button applies the change and re-solves</span>
            </div>
          )}
        </div>
      )}

      {manual?.error && (
        <div className="opt-alert error" role="alert">
          <h2>Rule check unavailable</h2>
          <p>{manual.error}</p>
        </div>
      )}

      {offline && (
        <div className="opt-note">
          Cannot reach the backend (run <b>python main.py</b> in Backend/, then press Run optimization again) — below is the sample plan bundled with the page.
        </div>
      )}
    </>
  );
}
