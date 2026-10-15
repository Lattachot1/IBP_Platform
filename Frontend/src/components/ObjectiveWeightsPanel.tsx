'use client';

import { Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_OBJECTIVE_WEIGHTS, OBJECTIVE_TERMS, type ObjectiveWeights, type SelectedOptimizationPlan } from '../lib/optimizationApi';

const PRESETS = [
  { name: 'Delivery priority', weights: { ...DEFAULT_OBJECTIVE_WEIGHTS, shortage: 5, service_target_violation: 3 } },
  { name: 'Lean inventory', weights: { ...DEFAULT_OBJECTIVE_WEIGHTS, finished_goods_holding: 5, raw_material_holding: 5 } },
  { name: 'Purchase priority', weights: { ...DEFAULT_OBJECTIVE_WEIGHTS, raw_material: 3 } },
];

export function ObjectiveWeightsPanel({ weights, legacyMultiplier, busy, onChange, onRun, onReset }: {
  weights: ObjectiveWeights;
  legacyMultiplier: number;
  busy: boolean;
  onChange: (weights: ObjectiveWeights) => void;
  onRun: () => void;
  onReset: () => void;
}) {
  const valid = Object.values(weights).some(v => v > 0);
  return <section className="objective-priorities" aria-label="Objective priorities">
    <header><div><span className="eyebrow">COMPANY PRIORITIES</span><h2>Objective weights</h2></div><div><button className="icon-button" title="Reset objective weights to 1" aria-label="Reset objective weights to 1" disabled={busy} onClick={onReset}><RotateCcw size={16} /></button><button className="button green" disabled={busy || !valid} onClick={onRun}><Play size={15} />{busy ? 'Solving priorities' : 'Apply priorities'}</button></div></header>
    <div className="objective-presets" role="group" aria-label="Priority presets">{PRESETS.map(p => <button key={p.name} aria-pressed={JSON.stringify(weights) === JSON.stringify(p.weights)} disabled={busy} onClick={() => onChange({ ...p.weights })}>{p.name}</button>)}</div>
    {(['expense', 'penalty'] as const).map(kind => <div className="objective-weight-group" key={kind}><h3>{kind === 'expense' ? 'Operating expenses' : 'Modeled risk penalties'}</h3>{OBJECTIVE_TERMS.filter(t => t.kind === kind).map(term => <div className="objective-weight-row" key={term.key}>
      <label htmlFor={`weight-${term.key}`}>{term.label}</label>
      <div><input type="range" aria-label={`${term.label} weight slider`} min={0} max={20} step={0.25} value={weights[term.key]} disabled={busy} onChange={e => onChange({ ...weights, [term.key]: Number(e.target.value) })} /><input id={`weight-${term.key}`} aria-label={`${term.label} weight`} type="number" min={0} max={20} step={0.25} value={weights[term.key]} disabled={busy} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value) && value >= 0 && value <= 20) onChange({ ...weights, [term.key]: value }); }} /><span>×</span></div>
    </div>)}</div>)}
    <p className="objective-policy"><SlidersHorizontal size={14} />Score = sum of weight × modeled cost component</p>
    <p className="objective-policy">1× = base importance. 0× ignores that objective term, not its constraints. Weights are relative; they do not need to sum to 100%.</p>
    <p className="objective-policy">Delivery and safety targets remain soft. High weight is not a zero-shortage guarantee. Prototype OT remains allowed; weight 0 does not prohibit OT.</p>
    {legacyMultiplier !== 1 && <p className="objective-warning">Saved legacy shortage multiplier: {legacyMultiplier}×. Effective shortage weight is {weights.shortage * legacyMultiplier}×.</p>}
    {!valid && <p className="objective-warning" role="alert">At least one weight must be greater than zero.</p>}
  </section>;
}

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
export function ObjectiveScorecard({ plan, dirty }: { plan: SelectedOptimizationPlan | undefined; dirty: boolean }) {
  if (!plan) return null;
  const available = plan.weighted_breakdown && plan.objective_weights;
  return <section className="objective-scorecard" aria-label="Applied objective results">
    <div className="objective-result-head"><div><span className="eyebrow">{dirty ? 'LAST APPLIED WEIGHTS / INPUTS CHANGED' : 'APPLIED OBJECTIVE / SAME PLAN'}</span><h2>Preferences are not the invoice.</h2></div><span className="label-chip">{plan.mode === 'deterministic' ? 'Base case score' : plan.mode === 'robust' ? 'Worst-case score' : 'Expected score'}</span></div>
    <div className="objective-result-metrics"><div><span>Expected operating expenses</span><strong data-testid="objective-operating-cost">{plan.expected_operating_cost === undefined ? 'Re-run required' : `$${number(plan.expected_operating_cost)}`}</strong><small>Unweighted / USD / penalties excluded</small></div><div><span>Expected modeled penalties</span><strong data-testid="objective-penalties">{plan.expected_penalty_cost === undefined ? 'Re-run required' : number(plan.expected_penalty_cost)}</strong><small>Unweighted monetary assumptions / not invoices</small></div><div><span>Solver weighted objective</span><strong data-testid="objective-score">{plan.optimized_weighted_score === undefined ? 'Re-run required' : number(plan.optimized_weighted_score)}</strong><small>Preference score / not payable USD</small></div></div>
    {available && <div className="table-scroll"><table><thead><tr><th>Objective component</th><th>Base amount / modeled USD</th><th>Applied weight</th><th>Weighted contribution</th></tr></thead><tbody>{OBJECTIVE_TERMS.map(term => <tr key={term.key}><td>{term.label}<small className="objective-term-kind">{term.kind === 'expense' ? 'Operating expense' : 'Modeled penalty'}</small></td><td>${number(plan.cost_breakdown[term.key] || 0)}</td><td data-testid={`applied-weight-${term.key}`}>{number(plan.objective_weights![term.key])}×</td><td>{number(plan.weighted_breakdown![term.key] || 0)}</td></tr>)}</tbody></table></div>}
    <p className="objective-policy">Breakdown contributions are probability-weighted expected values. The solver uses base / expected / worst-case aggregation according to the selected strategy. Scores from different weight sets are not directly comparable. Operating expenses exclude revenue: lower expense can reflect lost sales, not savings. Daily Gantt is a separate manual simulation.</p>
  </section>;
}
