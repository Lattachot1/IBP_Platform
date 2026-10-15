'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FlaskConical, Square, TrendingUp } from 'lucide-react';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { OBJECTIVE_TERMS, normalizeOptimizationRequest, runOptimizationDemo, type ObjectiveTerm, type OptimizationDemoRequest, type OptimizationDemoResponse } from '../lib/optimizationApi';
import { businessMetrics, comparableTrial, dominates, frozenInputKey, matchingModel, reportedPlanKey, tradeoff, trialRequest } from '../lib/objectiveExperiments';

const LEVELS = [0, 0.5, 1, 2, 3, 5, 10, 20];
const n = (value: number, digits = 1) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const signed = (value: number) => `${value > 0 ? '+' : ''}${n(value)}`;
type Point = { level: number; result?: OptimizationDemoResponse; error?: string; reference?: boolean };
type Study = {
  id: string; term: ObjectiveTerm; levels: number[]; reference: OptimizationDemoResponse;
  points: Point[]; startedAt: string; status: 'running' | 'complete' | 'cancelled' | 'failed'; invalidModel: boolean;
};

export function ObjectiveDecisionLab({ active, applied, currentInput, dirty, busy, onApply }: {
  active: boolean; applied: OptimizationDemoResponse | null; currentInput: OptimizationDemoRequest;
  dirty: boolean; busy: boolean; onApply: (result: OptimizationDemoResponse) => void;
}) {
  const [term, setTerm] = useState<ObjectiveTerm>('shortage');
  const [levels, setLevels] = useState([0, 0.5, 1, 2, 5, 10]);
  const [study, setStudy] = useState<Study | null>(null);
  const [running, setRunning] = useState(false), [progress, setProgress] = useState({ done: 0, total: 0 });
  const [notice, setNotice] = useState(''), [efficientOnly, setEfficientOnly] = useState(false);
  const [minService, setMinService] = useState(0), [budget, setBudget] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);

  async function runStudy() {
    if (!applied || controller.current || running || busy || !levels.length) return;
    const captured = structuredClone(applied), frozen = normalizeOptimizationRequest(captured.input);
    const chosenTerm = term, chosenLevels = [...levels].sort((a, b) => a - b);
    const abort = new AbortController(); controller.current = abort;
    const id = crypto.randomUUID();
    setRunning(true); setNotice('Verifying a fresh reference solve. Existing results are retained until verified.');
    setProgress({ done: 0, total: chosenLevels.length + 1 });
    let verified = false;
    try {
      const reference = await runOptimizationDemo(frozen, abort.signal);
      if (!reference.model_signature) {
        setStudy(s => s ? { ...s, invalidModel: true } : s);
        throw new Error('Backend model signature unavailable. Refresh the backend before running a controlled experiment.');
      }
      if (captured.model_signature && !matchingModel(captured, reference)) {
        setStudy(s => s ? { ...s, invalidModel: true } : s);
        throw new Error('Model or scenario context changed since the applied plan. Apply priorities again before sensitivity.');
      }
      if (frozenInputKey(reference.input) !== frozenInputKey(frozen)) throw new Error('Reference inputs do not match the captured request.');
      const referenceLevel = reference.input.objective_weights![chosenTerm];
      setStudy({ id, term: chosenTerm, levels: chosenLevels, reference, points: [{ level: referenceLevel, result: reference, reference: true }], startedAt: new Date().toISOString(), status: 'running', invalidModel: false });
      verified = true; setProgress({ done: 1, total: chosenLevels.length + 1 });
      for (const level of chosenLevels) {
        if (abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (level !== referenceLevel) {
          let input: OptimizationDemoRequest;
          try { input = trialRequest(frozen, chosenTerm, level); }
          catch (error) {
            setStudy(s => s?.id === id ? { ...s, points: [...s.points, { level, error: (error as Error).message }] } : s);
            setProgress(p => ({ ...p, done: p.done + 1 })); continue;
          }
          setNotice(`Solving ${level}× / only ${OBJECTIVE_TERMS.find(t => t.key === chosenTerm)!.label} varies`);
          const result = await runOptimizationDemo(input, abort.signal);
          if (!comparableTrial(reference, result, chosenTerm)) {
            setStudy(s => s?.id === id ? { ...s, invalidModel: true } : s);
            throw new Error('Model, scenarios or fixed inputs changed during the study. Results are not a controlled comparison; rerun the study.');
          }
          setStudy(s => s?.id === id ? { ...s, points: [...s.points, { level, result }] } : s);
        }
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
      setStudy(s => s?.id === id ? { ...s, status: 'complete' } : s);
      setNotice('Experiment complete. Only tested weight levels are represented; no global Pareto or feasibility claim.');
    } catch (error) {
      const cancelled = abort.signal.aborted;
      if (verified) setStudy(s => s?.id === id ? { ...s, status: cancelled ? 'cancelled' : 'failed' } : s);
      setNotice(cancelled ? verified ? 'Study cancelled. Completed points form a partial experiment. The current server solve may finish; the applied plan is unchanged.' : 'New study cancelled before reference verification. Previous experiment retained; the applied plan is unchanged.' : (error as Error).message);
    } finally {
      if (controller.current === abort) { controller.current = null; setRunning(false); }
    }
  }

  const points = useMemo(() => [...(study?.points || [])].sort((a, b) => a.level - b.level), [study]);
  const candidates = useMemo(() => points.filter((p): p is Point & { result: OptimizationDemoResponse } => !!p.result).map(p => ({ ...p, metrics: businessMetrics(p.result) })), [points]);
  const referenceMetrics = study && businessMetrics(study.reference);
  const modelChanged = !!study && !!applied && !matchingModel(study.reference, applied);
  const inputChanged = !!study && frozenInputKey(currentInput, study.term) !== frozenInputKey(study.reference.input, study.term);
  const labeled = candidates.map(p => ({ ...p, dominated: candidates.some(other => dominates(other.metrics, p.metrics)), samePlan: !!study && reportedPlanKey(p.result) === reportedPlanKey(study.reference) }));
  const visible = labeled.filter(p => (!efficientOnly || !p.dominated) && p.metrics.service + 1e-6 >= minService && (budget === '' || p.metrics.expense - referenceMetrics!.expense <= Number(budget) + 0.1));
  const chart = points.map(p => ({ weight: p.level, expense: p.result ? businessMetrics(p.result).expense / 1e6 : null, shortage: p.result ? businessMetrics(p.result).shortage : null }));
  function exportStudy() {
    if (!study) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'controlled_weight_sensitivity_mock', study, scope: 'One preference weight varies; business outcomes are modeled, revenue is excluded. Pareto labels concern only expense and unserved demand among tested points.' }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'ibp-weight-sensitivity.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function applyPoint(result: OptimizationDemoResponse) {
    if (!study || modelChanged || study.invalidModel || busy || running) return;
    if (inputChanged && !window.confirm('Current inputs differ from this experiment. Apply this tested plan and restore its frozen conditions and preference weights?')) return;
    onApply(structuredClone(result));
    setNotice('Tested plan applied with its own frozen inputs and weights. No daily Gantt re-optimization was performed.');
  }
  if (!active) return null;
  return <section className="objective-decision-lab" aria-label="Sensitivity and business tradeoffs">
    <header className="decision-section-head"><div><span className="eyebrow">CONTROLLED WEIGHT EXPERIMENT / MONTHLY OPTIMIZER</span><h2><FlaskConical size={19} />Sensitivity → Business trade-offs</h2></div><div className="decision-icon-tools">{running ? <button className="button" onClick={() => controller.current?.abort()}><Square size={14} />Cancel sensitivity</button> : <button className="button green" disabled={busy || !applied || !levels.length} onClick={runStudy}><TrendingUp size={15} />Run sensitivity</button>}<button className="icon-button" title="Export sensitivity experiment" aria-label="Export sensitivity experiment" disabled={!study || running} onClick={exportStudy}><Download size={16} /></button></div></header>
    <div className="sensitivity-controls"><label>Vary one objective<select aria-label="Sensitivity objective" value={term} disabled={running} onChange={e => setTerm(e.target.value as ObjectiveTerm)}>{OBJECTIVE_TERMS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label><fieldset><legend>Tested input multipliers</legend><div>{LEVELS.map(level => <label key={level}><input type="checkbox" aria-label={`Test ${level}x weight`} checked={levels.includes(level)} disabled={running} onChange={e => setLevels(v => e.target.checked ? [...v, level] : v.filter(n => n !== level))} />{level}×</label>)}</div></fieldset></div>
    {dirty && <p className="decision-warning">Experiment starts from the last successfully applied plan, not pending slider edits.</p>}
    <p className="objective-policy">Demand, capacity, prices, scenario probabilities, risk strategy, service target, other weights and the loaded model snapshot remain fixed. Effects are modeled, not observed business outcomes.</p>
    {running && <div className="sensitivity-progress"><progress max={progress.total} value={progress.done} aria-label="Sensitivity progress" /><span>{progress.done} / {progress.total}</span></div>}
    {notice && <p className="decision-study-notice" role="status" data-testid="sensitivity-status">{notice}</p>}
    {study && <>
      <div className="frozen-study-context" data-testid="frozen-study-context"><strong>{OBJECTIVE_TERMS.find(t => t.key === study.term)!.label}</strong><span>{study.reference.selected_strategy} / {study.status.toUpperCase()}</span><span>Reference {study.reference.input.objective_weights![study.term]}×</span><span>Model {study.reference.model_signature!.slice(0, 12)}</span></div>
      <details className="decision-detail"><summary>Frozen experiment context</summary><dl className="frozen-context-list"><div><dt>Captured</dt><dd>{new Date(study.startedAt).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })} Bangkok</dd></div><div><dt>Horizon</dt><dd>{study.reference.horizon.join(' / ')}</dd></div><div><dt>Demand / capacity / BD price adjustments</dt><dd>{study.reference.input.demand_adjustment_pct}% / {study.reference.input.capacity_adjustment_pct}% / {study.reference.input.raw_price_adjustment_pct}%</dd></div><div><dt>Service target / legacy shortage multiplier</dt><dd>{study.reference.input.service_target_pct}% / {study.reference.input.shortage_penalty_multiplier}×</dd></div>{OBJECTIVE_TERMS.filter(t => t.key !== study.term).map(t => <div key={t.key}><dt>{t.label}</dt><dd>{study.reference.input.objective_weights![t.key]}× fixed</dd></div>)}</dl></details>
      {(modelChanged || study.invalidModel) && <p className="decision-warning" role="alert">Model/context mismatch. Applying experiment plans is disabled; rerun from a current applied plan.</p>}
      {inputChanged && <p className="decision-warning">Current inputs differ from the frozen study. Selecting a tested plan restores that plan&apos;s original conditions.</p>}
      <div className="sensitivity-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} margin={{ top: 15, right: 15, left: 0, bottom: 12 }}><CartesianGrid vertical={false} stroke="#e1e9e3" /><XAxis dataKey="weight" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} label={{ value: 'Input weight multiplier', position: 'insideBottom', offset: -8, fontSize: 10 }} /><YAxis yAxisId="expense" tick={{ fontSize: 10 }} tickFormatter={v => `$${n(v)}M`} /><YAxis yAxisId="shortage" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `${n(v)}t`} /><Tooltip formatter={(value: any, name: any) => name === 'Operating expense' ? `$${n(Number(value) * 1e6)}` : `${n(Number(value))} t`} labelFormatter={value => `Weight ${value}×`} /><Legend verticalAlign="top" wrapperStyle={{ fontSize: 10, paddingBottom: 15 }} /><Line yAxisId="expense" dataKey="expense" name="Operating expense" type="linear" stroke="#388ba2" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls={false} /><Line yAxisId="shortage" dataKey="shortage" name="Unserved demand" type="linear" stroke="#c18752" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls={false} /></ComposedChart></ResponsiveContainer></div>
      <p className="objective-policy">Connected lines join tested points only, not continuous guarantees. Flat outcomes can mean a weight range changes no reported plan. Missing/invalid points have no interpolated result.</p>
      <div className="tradeoff-heading"><div><span className="eyebrow">CHOOSE A BUSINESS OUTCOME</span><h3>Expense versus fulfilled volume</h3></div><span>Relative to the frozen reference / no weighted-score ranking</span></div>
      <div className="tradeoff-filters"><label>Minimum fulfilment (%)<input aria-label="Tradeoff minimum fulfilment" type="number" min={0} max={100} step={0.5} value={minService} onChange={e => { const v = e.currentTarget.valueAsNumber; if (Number.isFinite(v) && v >= 0 && v <= 100) setMinService(v); }} /></label><label>Max extra operating expense (USD)<input aria-label="Tradeoff extra expense budget" type="number" min={0} step={1000} value={budget} placeholder="No limit" onChange={e => { if (e.target.value === '' || Number(e.target.value) >= 0) setBudget(e.target.value); }} /></label><label className="tradeoff-check"><input type="checkbox" checked={efficientOnly} onChange={e => setEfficientOnly(e.target.checked)} />Non-dominated tested outcomes only</label></div>
      <div className="table-scroll"><table className="tradeoff-table"><thead><tr><th>Tested plan</th><th>Operating expense</th><th>Extra expense</th><th>Fulfilment</th><th>Unserved</th><th>Extra dispatch</th><th>Expected FG</th><th>Trade-off vs reference</th><th /></tr></thead><tbody>{visible.map(p => {
        const impact = tradeoff(referenceMetrics!, p.metrics);
        return <tr key={p.level} data-testid={`tradeoff-point-${p.level}`}><td><strong>{p.reference ? 'Reference' : `${p.level}× candidate`}</strong><small>{study.term} = {p.level}×</small><small>{p.dominated ? 'Dominated in tested expense/shortage set' : 'Non-dominated in tested expense/shortage set'}{p.samePlan && !p.reference ? ' / same reported plan as reference' : ''}</small></td><td>${n(p.metrics.expense)}</td><td>{signed(impact.extraExpense)} USD</td><td>{n(p.metrics.service, 2)}%</td><td>{n(p.metrics.shortage)} t</td><td>{signed(impact.additionalDispatch)} t</td><td>{n(p.metrics.finishedStock)} t</td><td className={impact.lowerExpenseWithLostSales ? 'decision-risk' : ''}>{impact.expensePerAdditionalTon !== null ? `$${n(impact.expensePerAdditionalTon)} expense / additional ton dispatched` : impact.lowerExpenseWithLostSales ? 'Lower expense / more unserved: not demonstrated savings' : impact.additionalDispatch > 0.1 ? 'More dispatched without higher modeled expense' : impact.additionalDispatch < -0.1 ? 'Less dispatched' : 'No additional dispatched volume'}</td><td><button className="button" aria-label={`Use tested ${p.level}x plan`} disabled={running || busy || modelChanged || study.invalidModel} onClick={() => applyPoint(p.result)}><Check size={14} />Use plan</button></td></tr>;
      })}</tbody></table></div>
      {!visible.length && <p className="decision-warning">No tested plan meets these filters. This is not proof that the business targets are infeasible.</p>}
      {points.filter(p => p.error).map(p => <p className="decision-warning" key={p.level}>{p.level}× not solved: {p.error}</p>)}
      <p className="objective-policy">Non-dominance compares only operating expense and unserved demand within this tested set. Inventory, risk and other outcomes may differ. Filters use reported precision. Additional dispatch equals reduced unserved demand because demand is fixed. Revenue, customer loss and real feasibility require company validation.</p>
    </>}
  </section>;
}
