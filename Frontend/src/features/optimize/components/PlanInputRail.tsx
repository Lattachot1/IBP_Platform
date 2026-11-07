import Link from 'next/link';
import { HORIZON_MIN, HORIZON_MAX, TIME_LIMIT_MIN, TIME_LIMIT_MAX, OBJECTIVES } from '../planForm';
import { clamp } from '@/lib/format';
import type { OptimizePlan } from '../useOptimizePlan';
import type { OptimizeResult } from '../types';
import { DemandInputs } from './DemandInputs';

// Left rail: every plan input plus the Run button
export function PlanInputRail({ plan, data }: { plan: OptimizePlan; data: OptimizeResult }) {
  const { form, solving, problem, unapplied, showProblem, run, patch, updateDemand, setHoliday, removeHoliday, grades, objective, editing } = plan;
  return (
    <aside className="opt-rail" aria-label="Plan parameters">
      <div className="opt-panel opt-runbar">
        <button
          className={'opt-runbtn' + (unapplied && !solving ? ' attn' : '')}
          type="button"
          onClick={() => run()}
          disabled={solving}
        >
          {solving ? 'Solving…' : unapplied ? 'Run optimization (inputs changed)' : 'Run optimization'}
        </button>
        <div className="opt-solverstat" style={{ marginTop: 10 }}>
          <span className={'opt-st' + (showProblem ? ' bad' : '')}>{showProblem ? problem?.status : data.kpis.status}</span>
          <span className="mono">{data.kpis.solve_s.toFixed(2)} s</span>
          <span>· mode: {data.mode}</span>
        </div>
        {unapplied && (
          <div className="opt-unapplied" role="status">
            <b>⚠</b>
            <span>Inputs changed since the last solve — the plan on the right is for the previous inputs. Press Run to re-solve.</span>
          </div>
        )}
        {editing && (
          <div className="opt-unapplied" role="status">
            <b>✎</b>
            <span>Editing the plan by hand. Running the optimizer replaces the edited plan with a fresh solve.</span>
          </div>
        )}
      </div>

      <div className="opt-panel">
        <h2 className="opt-ph">Plan scope</h2>
        <div className="opt-fieldrow">
          <div className="opt-field">
            <label htmlFor="opt-start">Start date</label>
            <input
              id="opt-start"
              type="date"
              value={form.startDate}
              onChange={(e) => patch({ startDate: e.target.value })}
            />
          </div>
          <div className="opt-field">
            <label htmlFor="opt-horizon">Horizon (days)</label>
            <input
              id="opt-horizon"
              type="number"
              min={HORIZON_MIN}
              max={HORIZON_MAX}
              value={form.horizonDays}
              onChange={(e) => patch({ horizonDays: Number(e.target.value) })}
              onBlur={() => patch({ horizonDays: clamp(form.horizonDays, HORIZON_MIN, HORIZON_MAX) })}
            />
          </div>
        </div>
        <div className="opt-field">
          <label htmlFor="opt-objective">Objective</label>
          <select
            id="opt-objective"
            value={form.objective}
            onChange={(e) => patch({ objective: e.target.value })}
          >
            {OBJECTIVES.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <p className="opt-railnote">
          Blank start date = next Monday · horizon {HORIZON_MIN}–{HORIZON_MAX} days · objective = fulfilled tons − {objective.penalty} × changeover days
        </p>
      </div>

      <div className="opt-panel">
        <h2 className="opt-ph">Initial state (first day of the plan)</h2>
        <div className="opt-fieldrow">
          <div className="opt-field">
            <label htmlFor="opt-grade">Grade in production</label>
            <select
              id="opt-grade"
              value={form.initGrade}
              onChange={(e) => patch({ initGrade: e.target.value })}
            >
              {grades.map((g) => (
                <option key={g.id} value={g.id}>{g.disp}</option>
              ))}
            </select>
          </div>
          <div className="opt-field">
            <label htmlFor="opt-remain">Min-run days remaining</label>
            <input
              id="opt-remain"
              type="number"
              min={0}
              value={form.remainDays}
              onChange={(e) => patch({ remainDays: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
        <div className="opt-fieldrow">
          <div className="opt-field">
            <label htmlFor="opt-rx12">RX1–2 age (production days)</label>
            <input
              id="opt-rx12"
              type="number"
              min={0}
              value={form.rx12Age}
              onChange={(e) => patch({ rx12Age: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="opt-field">
            <label htmlFor="opt-rx34">RX3–4 age (production days)</label>
            <input
              id="opt-rx34"
              type="number"
              min={0}
              value={form.rx34Age}
              onChange={(e) => patch({ rx34Age: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
      </div>

      <div className="opt-panel">
        <h2 className="opt-ph">Demand source</h2>
        <div className="opt-sourcepick" role="radiogroup" aria-label="Demand source">
          <label>
            <input
              type="radio"
              name="opt-source"
              checked={!form.usePlanningData}
              onChange={() => patch({ usePlanningData: false })}
            />
            Tons per grade (below)
          </label>
          <label>
            <input
              type="radio"
              name="opt-source"
              checked={form.usePlanningData}
              onChange={() => patch({ usePlanningData: true })}
            />
            Planning data — plan per product
          </label>
        </div>
        {form.usePlanningData ? (
          <p className="opt-railnote">
            Orders, minimum stock and the monthly forecast come from the{' '}
            <Link href="/planning-data">Planning Data</Link> page: stock, lots in QC
            (5 days before output reaches stock), open sales orders and the forecast still to produce.
            The plant rules stay on the product groups.
          </p>
        ) : (
          <>
            <DemandInputs
              form={form}
              grades={grades}
              catalog={plan.catalog}
              updateDemand={updateDemand}
              updateProductDemand={plan.updateProductDemand}
            />
            <p className="opt-railnote">
              Tons to deliver within the horizon — the solver maximizes how much of this it can produce. ▸ expands a group into its products.
            </p>
          </>
        )}
      </div>

      <div className="opt-panel">
        <h2 className="opt-ph">Calendar &amp; Solver</h2>
        <div className="opt-field">
          <label>Company holidays in horizon</label>
          {form.holidays.length === 0 && (
            <p className="opt-railnote" style={{ margin: '0 0 6px' }}>
              None — Saturdays and Sundays are blocked automatically.
            </p>
          )}
          {form.holidays.map((h, i) => (
            <div className="opt-holrow" key={i}>
              <input
                type="date"
                value={h}
                min={form.startDate || undefined}
                aria-label={`holiday ${i + 1}`}
                onChange={(e) => setHoliday(i, e.target.value)}
              />
              <button
                type="button"
                className="opt-iconbtn"
                aria-label={`Remove holiday ${i + 1}`}
                title="Remove"
                onClick={() => removeHoliday(i)}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="opt-addbtn"
            onClick={() => patch({ holidays: [...form.holidays, ''] })}
          >
            + Add holiday
          </button>
        </div>
        <div className="opt-field">
          <label htmlFor="opt-tlim">Solver time limit (s) · CP-SAT / OR-Tools</label>
          <input
            id="opt-tlim"
            type="number"
            min={TIME_LIMIT_MIN}
            max={TIME_LIMIT_MAX}
            value={form.timeLimitS}
            onChange={(e) => patch({ timeLimitS: Number(e.target.value) })}
            onBlur={() => patch({ timeLimitS: clamp(form.timeLimitS, TIME_LIMIT_MIN, TIME_LIMIT_MAX) })}
          />
        </div>
        <p className="opt-railnote">
          No grade switch happens on a weekend or holiday, and a VCR campaign never ends on one. Every plant rule is listed under the plan.
        </p>
      </div>
    </aside>
  );
}
