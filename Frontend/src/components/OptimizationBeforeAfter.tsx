'use client';

import { useState } from 'react';
import { GitCompareArrows, Pin, PinOff, Target } from 'lucide-react';
import { businessMetrics, inputChanges } from '../lib/objectiveExperiments';
import { OBJECTIVE_TERMS, type OptimizationDemoResponse } from '../lib/optimizationApi';

const n = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const delta = (value: number) => `${value > 0 ? '+' : ''}${n(value)}`;
type Row = { group: string; label: string; before: number; after: number; unit: string };
export function OptimizationBeforeAfter({ reference, current, pinned, dirty, onTogglePin, onUseCurrent }: {
  reference: OptimizationDemoResponse | null; current: OptimizationDemoResponse | null; pinned: boolean; dirty: boolean;
  onTogglePin: () => void; onUseCurrent: () => void;
}) {
  const [tab, setTab] = useState<'monthly' | 'grades' | 'costs'>('monthly');
  const [changesOnly, setChangesOnly] = useState(true);
  if (!reference || !current) return null;
  const before = businessMetrics(reference), after = businessMetrics(current), changes = inputChanges(reference, current);
  const metrics = [
    { key: 'expense' as const, label: 'Expected operating expense', unit: 'USD', prefix: '$' },
    { key: 'service' as const, label: 'Volume fulfilment', unit: '% / delta in pp', prefix: '' },
    { key: 'shortage' as const, label: 'Unserved demand / lost sales', unit: 't', prefix: '' },
    { key: 'finishedStock' as const, label: 'Expected closing FG', unit: 't / end of horizon', prefix: '' },
    { key: 'rawStock' as const, label: 'Closing raw stock', unit: 't / end of horizon', prefix: '' },
    { key: 'purchase' as const, label: 'Total raw purchases', unit: 't', prefix: '' },
  ];
  const a = reference.selected_plan, b = current.selected_plan;
  const monthly: Row[] = Array.from(new Set([...a.monthly_plan, ...b.monthly_plan].map(m => m.period))).flatMap(period => {
    const left = a.monthly_plan.find(m => m.period === period), right = b.monthly_plan.find(m => m.period === period);
    return ([['planned_production_tons', 'Production', 't'], ['raw_material_purchase_tons', 'Raw purchases', 't'], ['ending_raw_inventory_tons', 'Closing raw stock', 't'], ['active_campaigns', 'Active grade-months', 'count']] as const).map(([key, label, unit]) => ({ group: period, label, before: left?.[key] || 0, after: right?.[key] || 0, unit }));
  });
  const grades: Row[] = Array.from(new Set([...a.product_plan, ...b.product_plan].map(p => p.product))).flatMap(product => {
    const left = a.product_plan.find(p => p.product === product), right = b.product_plan.find(p => p.product === product);
    return ([['planned_production_tons', 'Production'], ['expected_ending_inventory_tons', 'Expected closing FG'], ['expected_shortage_tons', 'Expected unserved demand']] as const).map(([key, label]) => ({ group: product, label, before: left?.[key] || 0, after: right?.[key] || 0, unit: 't' }));
  });
  const costs: Row[] = OBJECTIVE_TERMS.map(t => ({ group: t.kind === 'expense' ? 'Operating expense' : 'Modeled penalty', label: t.label, before: a.cost_breakdown[t.key] || 0, after: b.cost_breakdown[t.key] || 0, unit: 'USD assumptions' }));
  const rows = { monthly, grades, costs }[tab], changedRows = rows.filter(r => Math.abs(r.after - r.before) > 0.05);
  const incomeCaution = after.expense < before.expense - 0.1 && after.shortage > before.shortage + 0.1;
  return <section className="decision-before-after" aria-label="Before and after optimization">
    <header className="decision-section-head"><div><span className="eyebrow">APPLIED PLAN COMPARISON / UNWEIGHTED BUSINESS OUTCOMES</span><h2><GitCompareArrows size={19} />Before → After</h2></div><div className="decision-icon-tools"><span>{pinned ? 'Pinned reference' : 'Previous applied plan'}</span><button className="icon-button" aria-label={pinned ? 'Unpin comparison reference' : 'Pin comparison reference'} title={pinned ? 'Unpin comparison reference' : 'Pin comparison reference'} aria-pressed={pinned} onClick={onTogglePin}>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button><button className="icon-button" aria-label="Use current plan as comparison reference" title="Use current plan as comparison reference" onClick={onUseCurrent}><Target size={16} /></button></div></header>
    <div className="decision-comparison-context"><span>Before: {reference.selected_strategy}</span><span>After: {current.selected_strategy}</span><span>{changes.weights.length ? changes.weights.map(w => `${w.label}: ${w.before}× → ${w.after}×`).join(' / ') : 'Same preference weights'}</span></div>
    {dirty && <p className="decision-warning">Pending edits are not included. Comparison uses successfully applied results only.</p>}
    {(!changes.modelMatches || changes.conditions.length > 0) && <p className="decision-warning" data-testid="comparison-confound">Not a weight-only comparison: {changes.conditions.map(v => v.replace(/_/g, ' ')).join(', ') || 'model version / scenario context differs'}. Changes cannot be attributed only to preference weights.</p>}
    <div className="decision-metric-grid">{metrics.map(m => <div key={m.key}><span>{m.label}</span><div className="decision-before-value">Before {m.prefix}{n(before[m.key])}{m.key === 'service' ? '%' : ''}</div><strong data-testid={`after-${m.key}`}>{m.prefix}{n(after[m.key])}{m.key === 'service' ? '%' : ''}</strong><small data-testid={`delta-${m.key}`}>{delta(after[m.key] - before[m.key])} {m.key === 'service' ? 'pp' : m.unit}</small></div>)}</div>
    {incomeCaution && <p className="decision-warning">Lower expense comes with more unserved demand. This is not demonstrated savings; revenue is not modeled.</p>}
    <details className="decision-detail"><summary>Plan changes / monthly decisions, grades and cost components</summary><div className="decision-detail-toolbar"><div className="decision-segments" role="group" aria-label="Before after detail view">{(['monthly', 'grades', 'costs'] as const).map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'monthly' ? 'Monthly decisions' : t === 'grades' ? 'Product grades' : 'Cost components'}</button>)}</div><label><input type="checkbox" checked={changesOnly} onChange={e => setChangesOnly(e.target.checked)} />Changes only</label></div><div className="table-scroll"><table><thead><tr><th>Scope</th><th>Decision / metric</th><th>Before</th><th>After</th><th>Difference</th></tr></thead><tbody>{(changesOnly ? changedRows : rows).map(r => <tr key={`${r.group}:${r.label}`}><td>{r.group}</td><td>{r.label}</td><td>{n(r.before)}</td><td>{n(r.after)}</td><td>{delta(r.after - r.before)} <small>{r.unit}</small></td></tr>)}</tbody></table></div>{changesOnly && !changedRows.length && <p className="objective-policy">No change in these reported decisions at the displayed precision.</p>}</details>
    <p className="objective-policy">Amounts use each plan's configured, unweighted rates. Changing a holding rate changes the accounting basis; a lower reported total alone is not demonstrated cash savings. Preference scores are not compared. Volume fulfilment is not an on-time-arrival probability.</p>
  </section>;
}
