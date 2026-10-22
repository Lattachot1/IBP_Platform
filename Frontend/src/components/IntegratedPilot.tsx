'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FileUp, Link2, LockKeyhole, Play, RotateCcw, UnlockKeyhole } from 'lucide-react';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HoldingCostsPanel } from './HoldingCostsPanel';
import { DemandForecastBridge } from './DemandForecastBridge';
import { DEFAULT_HOLDING_COSTS, type OptimizationDemoResponse } from '../lib/optimizationApi';
import { evenSpread, forecastSourceCurrent, PILOT_GRADES as GRADES, PILOT_WEIGHTS, pilotApi, stableInput, type IntegratedInput, type IntegratedResult } from '../lib/integratedPlanning';
import './integrated-pilot.css';

const colors = ['#23886b', '#4185a1', '#c4844d', '#a09232', '#8b6ba4', '#617a6b'];
const n = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const sum = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);
const label = (key: string) => key.replaceAll('_', ' ');
const isoDay = (start: string, day: number) => new Date(new Date(start + 'T12:00:00Z').getTime() + day * 86400000).toISOString().slice(0, 10);

export function IntegratedPilot({ active, source }: { active: boolean; source: OptimizationDemoResponse | null }) {
  const [input, setInput] = useState<IntegratedInput | null>(null);
  const [result, setResult] = useState<IntegratedResult | null>(null);
  const [before, setBefore] = useState<IntegratedResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const booted = useRef(false), sequence = useRef(0), file = useRef<HTMLInputElement>(null);
  async function loadDemo(days: number) {
    const id = ++sequence.current;
    setLoading(true); setError('');
    try {
      const data = await pilotApi<IntegratedInput>('pilot?horizon_days=' + days);
      if (id === sequence.current) { setInput(data); setSelected(0); }
    } catch (e) { if (id === sequence.current) setError(String(e)); }
    finally { if (id === sequence.current) setLoading(false); }
  }
  useEffect(() => { if (active && !booted.current) { booted.current = true; void loadDemo(28); } }, [active]);
  async function solve() {
    if (!input) return;
    const id = ++sequence.current;
    setBusy(true); setError('');
    try {
      const data = await pilotApi<IntegratedResult>('integrated', input);
      if (id !== sequence.current) return;
      if (data.status !== 'feasible' || !data.integration) { setError(data.status + ': ' + data.message); return; }
      setBefore(result); setResult(data); setInput(data.input);
    } catch (e) { if (id === sequence.current) setError(String(e)); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  async function copyMonthly() {
    if (!source) return;
    const start = source.horizon[0] + '-01';
    const [year, month] = source.horizon.at(-1)!.split('-').map(Number);
    const end = new Date(Date.UTC(year, month, 1));
    const days = Math.round((end.getTime() - new Date(start + 'T00:00:00Z').getTime()) / 86400000);
    if (days < 7 || days > 62) { setError('Monthly snapshot must cover 7-62 calendar days.'); return; }
    setLoading(true); setError('');
    try {
      const data = await pilotApi<IntegratedInput>('pilot?horizon_days=' + days);
      data.plant.start_date = start;
      data.input_note = 'Copied monthly demo totals and base BD price assumptions. Firm orders set to 0; residual demand spread evenly, NOT actual daily due dates. Opening stocks, BOM and committed receipts remain demo values. Locks cleared.';
      for (const g of GRADES) {
        data.firm_demand[g] = Array(days).fill(0);
        data.forecast_residual[g] = evenSpread(Math.round(source.selected_plan.product_plan.find(p => p.product === g)?.base_demand_tons || 0), days);
      }
      const basePrices = source.scenario_definitions.find(s => s.scenario === 'base')!;
      data.raw_prices = Array.from({ length: days }, (_, d) => basePrices.raw_prices[source.horizon.indexOf(isoDay(start, d).slice(0, 7))]);
      data.holding_costs = structuredClone(source.input.holding_costs || DEFAULT_HOLDING_COSTS);
      for (const k of PILOT_WEIGHTS) data.weights[k] = (source.input.objective_weights as Record<string, number> | undefined)?.[k] ?? 1;
      data.weights.shortage *= source.input.shortage_penalty_multiplier;
      // The monthly legacy multiplier can exceed the pilot's explicit weight range.
      if (data.weights.shortage > 20) throw new Error('Effective monthly shortage weight exceeds 20. Set a pilot priority explicitly.');
      setInput(data); setSelected(0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  async function importFile(selectedFile?: File) {
    if (!selectedFile) return;
    setLoading(true); setError('');
    try {
      if (selectedFile.size > 2_000_000) throw new Error('Input JSON exceeds 2 MB.');
      const parsed = JSON.parse(await selectedFile.text());
      const normalized = await pilotApi<IntegratedInput>('validate', parsed.input || parsed);
      setInput(normalized); setSelected(0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); if (file.current) file.current.value = ''; }
  }
  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  function patch(change: Partial<IntegratedInput>) { setError(''); setInput(current => current ? { ...current, ...change } : current); }
  if (!active) return null;
  const disabled = busy || loading;
  const unresolvedDemand = !!input?.demand_source && !forecastSourceCurrent(input) && !input.demand_source.manual_override_acknowledged;
  const report = result?.integration, dirty = !!input && !!result && stableInput(input) !== stableInput(result.input);
  const h = input?.plant.horizon_days || 28;
  const day = Math.min(selected, h - 1);
  const planDate = input && isoDay(input.plant.start_date, day);
  const sameCalendar = !!result && !!input && result.start_date === input.plant.start_date && result.horizon_days === h;
  const shownDay = sameCalendar ? result?.days[day] : undefined;
  const shownFlow = sameCalendar ? report?.daily[day] : undefined;
  const mainGrade = shownDay?.parts.at(-1)?.grade;
  const lock = input?.day_locks.find(x => x.day === day);
  const purchaseLock = input?.purchase_locks.find(x => x.day === day);
  const numberField = (name: string, value: number, update: (value: number) => void, min = 0, max = 50000, step = 1) => <label className="joint-field"><span>{name}</span><input aria-label={name} type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={e => { const v = e.currentTarget.valueAsNumber; if (Number.isFinite(v) && v >= min && v <= max) update(v); }} /></label>;
  const chart = report?.daily.map(row => ({ date: row.date.slice(5), raw: row.raw_stock_tons, fg: sum(row.fg_stock), demand: row.demand_tons, dispatch: sum(row.dispatch) })) || [];
  return <section className="joint-pilot" aria-label="Integrated planning pilot">
    <header className="joint-head"><div><span className="eyebrow">DETERMINISTIC / SHARED FACTORY RULES / MIXED INPUT SOURCES</span><h2>One plan, from purchase to dispatch</h2></div><div className="joint-actions">
      <button className="button" disabled={disabled || !source} onClick={() => void copyMonthly()}><Link2 size={15} />Copy monthly assumptions</button>
      <button className="icon-button" title="Import pilot input JSON" aria-label="Import pilot input JSON" disabled={disabled} onClick={() => file.current?.click()}><FileUp size={17} /></button>
      <input hidden type="file" accept=".json,application/json" ref={file} onChange={e => void importFile(e.target.files?.[0])} />
      <button className="button green" disabled={disabled || !input || unresolvedDemand} onClick={() => void solve()}><Play size={15} />{busy ? 'Solving joint plan' : 'Solve integrated plan'}</button>
    </div></header>
    <div className="joint-pipeline"><span>Order BD</span><ArrowRight size={15} /><span>Receive & store</span><ArrowRight size={15} /><span>Daily factory</span><ArrowRight size={15} /><span>Release FG</span><ArrowRight size={15} /><span>Dispatch</span></div>
    {error && <p className="joint-error" role="alert">{error} Previous solved plan is retained; no silent constraint relaxation.</p>}
    {loading && <p role="status">Loading validated inputs...</p>}
    {input && <>
      <div className="joint-toolbar">
        <label className="joint-field"><span>Start date</span><input aria-label="Integrated start date" type="date" value={input.plant.start_date} disabled={disabled} onChange={e => { if (e.target.value) patch({ plant: { ...input.plant, start_date: e.target.value } }); }} /></label>
        <label className="joint-field"><span>Objective policy</span><select aria-label="Integrated objective policy" disabled={disabled} value={input.policy} onChange={e => patch({ policy: e.target.value as IntegratedInput['policy'] })}><option value="weighted_cost">Cost / shortage trade-off</option><option value="delivery_first">Delivery first, then cost</option></select></label>
        {numberField('Solve budget (s)', input.plant.time_limit_s, v => patch({ plant: { ...input.plant, time_limit_s: v } }), 5, 300)}
        <label className="joint-toggle"><input type="checkbox" disabled={disabled} checked={input.plant.full_rate} onChange={e => patch({ plant: { ...input.plant, full_rate: e.target.checked } })} />Nominal full-rate production</label>
        <div className="joint-actions"><button className="button" disabled={disabled} onClick={() => void loadDemo(28)}><RotateCcw size={14} />28-day demo</button><button className="button" disabled={disabled} onClick={() => void loadDemo(56)}>56-day demo</button></div>
      </div>
      <p className="joint-note">{input.input_note} No OT. Purchase and production quantities are integer tons; BD balance uses kilograms. Stock, purchasing rules and BD prices remain separate user/demo inputs.</p>
      <DemandForecastBridge input={input} disabled={disabled} onStart={() => { setLoading(true); setError(''); }} onLoaded={next => setInput(next)} onError={message => setError(message)} onFinish={() => setLoading(false)} />
      <details className="joint-inputs"><summary>Inputs / orders, residual forecast, stock and factory state</summary>
        <div className="joint-table-scroll"><table><thead><tr><th>Product group</th><th>Opening FG (t)</th><th>Firm due (t)</th><th>Residual forecast (t)</th><th>BOM (kg BD/t)</th></tr></thead><tbody>{GRADES.map(g => <tr key={g}><th>{g}</th><td>{numberField(g + ' opening FG', input.opening_fg[g], v => patch({ opening_fg: { ...input.opening_fg, [g]: v } }))}</td><td>{numberField(g + ' firm total', input.firm_demand[g].reduce((a, b) => a + b, 0), v => patch({ firm_demand: { ...input.firm_demand, [g]: evenSpread(v, h) } }), 0, 100000)}</td><td>{numberField(g + ' residual forecast total', input.forecast_residual[g].reduce((a, b) => a + b, 0), v => patch({ forecast_residual: { ...input.forecast_residual, [g]: evenSpread(v, h) } }), 0, 100000)}</td><td>{numberField(g + ' BOM', input.bom_kg_per_ton[g], v => patch({ bom_kg_per_ton: { ...input.bom_kg_per_ton, [g]: v } }), 500, 2000)}</td></tr>)}</tbody></table></div>
        <p className="joint-note">Firm + residual = total daily demand. Residual must exclude booked orders. Editing a horizon total spreads it evenly; select a day below for exact due-date edits or import JSON.</p>
        <div className="joint-input-grid">
          {numberField('Opening BD stock (t)', input.opening_raw_tons, v => patch({ opening_raw_tons: v }))}
          {numberField('BD tank capacity (t)', input.raw_storage_tons, v => patch({ raw_storage_tons: v }), 1)}
          {numberField('Purchase limit (t/day)', input.purchase_limit_tons_per_day, v => patch({ purchase_limit_tons_per_day: v }), 0, 10000)}
          {numberField('Purchase lead time (days)', input.purchase_lead_days, v => patch({ purchase_lead_days: v }), 0, 28)}
          {numberField('FG release lag (days)', input.release_lag_days, v => patch({ release_lag_days: v }), 0, 14)}
          {numberField('Initial RX1-2 age', input.plant.initial.rx12_age, v => patch({ plant: { ...input.plant, initial: { ...input.plant.initial, rx12_age: v } } }), 0, 60)}
          {numberField('Initial RX3-4 age', input.plant.initial.rx34_age, v => patch({ plant: { ...input.plant, initial: { ...input.plant.initial, rx34_age: v } } }), 0, 60)}
          <label className="joint-field"><span>Initial main grade</span><select aria-label="Initial main grade" value={input.plant.initial.grade} disabled={disabled} onChange={e => patch({ plant: { ...input.plant, initial: { ...input.plant.initial, grade: e.target.value } } })}>{GRADES.map(g => <option key={g}>{g}</option>)}</select></label>
          {numberField('Initial remaining run (days)', input.plant.initial.remain_days, v => patch({ plant: { ...input.plant, initial: { ...input.plant.initial, remain_days: v } } }), 0, h)}
          {numberField('Initial elapsed VCR days', input.plant.initial.vcr_elapsed_days, v => patch({ plant: { ...input.plant, initial: { ...input.plant.initial, vcr_elapsed_days: v } } }), 0, 120)}
        </div>
        <p className="joint-note">Committed BD receipts: {input.raw_pipeline.map(x => `${isoDay(input.plant.start_date, x.day)}: ${n(x.tons)} t`).join(' / ') || 'none'}. These are fixed, already-ordered arrivals, not newly optimized purchases. FG pipeline releases: {n(input.fg_pipeline.reduce((a, b) => a + b.tons, 0))} t. Edit pipeline dates/quantities and holidays via input JSON.</p>
        <HoldingCostsPanel rates={input.holding_costs} busy={disabled} onChange={rates => patch({ holding_costs: rates })} />
        <div className="joint-input-grid">{PILOT_WEIGHTS.map(k => numberField(label(k) + ' priority', input.weights[k], v => patch({ weights: { ...input.weights, [k]: v } }), 0, 20, 0.25))}</div>
        <p className="joint-note">Only the six displayed terms are modeled. Safety-stock and service-target penalties from the monthly model are not copied. Delivery-first is lexicographic only when the shortage stage is proven optimal. Holding charges use month ends plus the final partial-month close, without prorating.</p>
      </details>
      <div className="joint-status" role="status"><strong>{busy ? 'Solver running / previous result retained' : result ? dirty ? 'Inputs changed / previous plan is not current' : 'Solved plan matches current inputs' : 'Inputs ready / no joint plan solved yet'}</strong><span>{h} days / {input.day_locks.length} production locks / {input.purchase_locks.length} purchase locks</span></div>
      {report && result && <>
        <p className="joint-note" data-testid="solved-demand-source">Last solved demand: {result.input.demand_source ? `${result.input.demand_source.path} path / snapshot ${result.input.demand_source.snapshot_id.slice(0, 12)} / ${result.input.demand_source.status === 'modified' ? 'manual override' : 'captured billing forecast'}` : 'manual / demo inputs'}. {dirty ? 'Pending input changes are not reflected in the results below.' : 'Results use the current captured inputs.'}</p>
        <div className="joint-kpis"><div><span>Operating expense / USD assumptions</span><strong>${n(report.operating_cost_usd)}</strong><small>Excludes modeled shortage loss</small></div><div><span>On-due-day volume fulfilled</span><strong>{n(report.fulfillment_pct, 2)}%</strong><small>{n(report.shortage_tons)} t unserved / {n(report.firm_shortage_tons)} t firm</small></div><div><span>Closing FG / unreleased WIP</span><strong>{n(report.closing_fg_tons)} / {n(report.closing_wip_tons)} t</strong><small>WIP is not available to dispatch early</small></div><div><span>Solver outcome</span><strong>{report.optimality_proven ? 'Optimal' : 'Feasible'}</strong><small>{n(result.solve_s, 1)} s / {report.optimality_proven ? 'Proof for stated objective' : 'Optimality not proven'}</small></div></div>
        {result.input.policy === 'delivery_first' && !report.stages[0]?.proven_optimal && <p className="joint-note">Shortage optimum is not proven within the time budget. Cost refinement was not run; this is a feasible delivery-stage incumbent, not a lexicographic optimum.</p>}
        {before?.integration && <p className="joint-comparison" data-testid="joint-before-after">Previous solve: expense ${n(before.integration.operating_cost_usd)} → ${n(report.operating_cost_usd)} / unserved {n(before.integration.shortage_tons)} → {n(report.shortage_tons)} t. {stableInput({ ...before.input, day_locks: [], purchase_locks: [] }) === stableInput({ ...result.input, day_locks: [], purchase_locks: [] }) ? 'Other inputs unchanged; solver optimality may differ.' : 'Input assumptions also differ; not a controlled savings claim.'}</p>}
        <div className="joint-chart" aria-label="Solved raw and finished goods stocks"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} margin={{ top: 10, right: 14, bottom: 5, left: 5 }}><CartesianGrid stroke="#dce7df" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} /><YAxis tick={{ fontSize: 10 }} width={45} unit=" t" /><Tooltip /><Legend wrapperStyle={{ fontSize: 10 }} /><Line dataKey="raw" name="BD closing stock" stroke="#367f9b" dot={false} strokeWidth={2} /><Line dataKey="fg" name="FG closing stock" stroke="#218566" dot={false} strokeWidth={2} /><Line dataKey="demand" name="Demand due" stroke="#c38a42" dot={false} strokeDasharray="4 3" /><Line dataKey="dispatch" name="Dispatched" stroke="#8d6baa" dot={false} /></ComposedChart></ResponsiveContainer></div>
        <header className="joint-section-title"><h3>Production, purchases & stock / last solved plan</h3><div className="joint-actions"><button className="button" disabled={disabled || dirty} onClick={() => download({ source: 'Unapproved deterministic joint pilot', ...result }, 'ube-integrated-plan.json')}><Download size={15} />Export solved plan</button></div></header>
        <div className="joint-gantt-scroll"><div className="joint-gantt" style={{ width: 110 + result.days.length * 42 }}>
          <div className="joint-gantt-row"><strong>Day</strong>{result.days.map((d, i) => <button key={d.iso} aria-label={'Select integrated day ' + (i + 1)} aria-pressed={selected === i && sameCalendar} title={d.iso} onClick={() => { if (sameCalendar) setSelected(i); }} disabled={!sameCalendar}><small>{d.iso.slice(5, 7)}/{d.iso.slice(8)}</small>{d.wd}</button>)}</div>
          {GRADES.map((g, gi) => <div className="joint-gantt-row" key={g}><strong style={{ color: colors[gi] }}>{g}</strong>{result.days.map((d, i) => { const quantity = d.parts.find(p => p.grade === g)?.tons || 0; const ghost = before?.days.find(x => x.iso === d.iso)?.parts.find(p => p.grade === g)?.tons || 0; return <button key={d.iso} className={quantity ? 'joint-production' : ''} style={quantity ? { background: colors[gi] } : {}} title={`${d.iso} / ${g}: ${quantity} t / prior solve ${ghost} t${input.day_locks.some(x => x.day === i) && sameCalendar ? ' / pending lock' : ''}`} aria-label={`${g} production day ${i + 1}: ${quantity} tons`} disabled={!sameCalendar} onClick={() => setSelected(i)}>{quantity || ''}{before && ghost > 0 && <i className="joint-ghost" />}</button>; })}</div>)}
          {(['purchase_tons', 'receipt_tons', 'raw_stock_tons'] as const).map(k => <div className="joint-gantt-row joint-flow-row" key={k}><strong>{k === 'purchase_tons' ? 'Buy BD' : k === 'receipt_tons' ? 'Receive BD' : 'BD close'}</strong>{report.daily.map((d, i) => <button key={d.date} disabled={!sameCalendar} onClick={() => setSelected(i)} title={label(k) + ': ' + d[k]}>{n(d[k])}</button>)}</div>)}
        </div></div>
        <p className="joint-note">Bottom stripe = production in the previous solve, not an automatically feasible alternative. All quantities above belong to the last solved plan. {dirty ? 'Pending locks/edits are not applied yet.' : 'Locks in the input are enforced as hard constraints.'}</p>
      </>}
      <section className="joint-day-editor" aria-label="Integrated day editor"><header className="joint-section-title"><h3>Day {day + 1} / {planDate}</h3><div className="joint-actions"><button className="icon-button" title="Previous day" aria-label="Previous integrated day" disabled={disabled || day === 0} onClick={() => setSelected(day - 1)}><ArrowLeft size={16} /></button><button className="icon-button" title="Next day" aria-label="Next integrated day" disabled={disabled || day === h - 1} onClick={() => setSelected(day + 1)}><ArrowRight size={16} /></button></div></header>
        <div className="joint-toolbar">
          <label className="joint-field"><span>Main-grade lock</span><select aria-label="Locked integrated grade" value={lock?.grade || ''} disabled={disabled} onChange={e => patch({ day_locks: [...input.day_locks.filter(x => x.day !== day), ...(e.target.value ? [{ day, grade: e.target.value }] : [])] })}><option value="">Unlocked{mainGrade ? ' / solved ' + mainGrade : ''}</option>{GRADES.map(g => <option key={g}>{g}</option>)}</select></label>
          <button className="button" disabled={disabled || !shownDay} onClick={() => { if (shownDay) patch({ day_locks: [...input.day_locks.filter(x => x.day !== day), { day, grade: mainGrade!, production: Object.fromEntries(shownDay.parts.map(p => [p.grade, p.tons])), rx12: shownDay.p1, rx34: shownDay.p2 }] }); }}><LockKeyhole size={15} />Freeze solved day</button>
          <button className="icon-button" aria-label="Unlock integrated production day" title="Unlock production day" disabled={disabled || !lock} onClick={() => patch({ day_locks: input.day_locks.filter(x => x.day !== day) })}><UnlockKeyhole size={16} /></button>
          {numberField('Purchase lock (t)', purchaseLock?.tons ?? shownFlow?.purchase_tons ?? 0, v => patch({ purchase_locks: [...input.purchase_locks.filter(x => x.day !== day), { day, tons: v }] }), 0, input.purchase_limit_tons_per_day)}
          <button className="button" disabled={disabled || !shownFlow} onClick={() => patch({ purchase_locks: [...input.purchase_locks.filter(x => x.day !== day), { day, tons: shownFlow!.purchase_tons }] })}><LockKeyhole size={15} />Freeze purchase</button>
          <button className="icon-button" aria-label="Unlock integrated purchase day" title="Unlock purchase day" disabled={disabled || !purchaseLock} onClick={() => patch({ purchase_locks: input.purchase_locks.filter(x => x.day !== day) })}><UnlockKeyhole size={16} /></button>
          {numberField('BD order price (USD/t)', input.raw_prices[day], v => patch({ raw_prices: input.raw_prices.map((p, i) => i === day ? v : p) }), 0, 10000, 0.01)}
        </div>
        <div className="joint-table-scroll"><table><thead><tr><th>Product</th><th>Firm due (t)</th><th>Residual due (t)</th><th>Last dispatch (t)</th><th>Last shortage (t)</th><th>Last closing FG (t)</th></tr></thead><tbody>{GRADES.map(g => <tr key={g}><th>{g}</th><td>{numberField(g + ' firm selected day', input.firm_demand[g][day], v => patch({ firm_demand: { ...input.firm_demand, [g]: input.firm_demand[g].map((x, i) => i === day ? v : x) } }), 0, 10000)}</td><td>{numberField(g + ' forecast selected day', input.forecast_residual[g][day], v => patch({ forecast_residual: { ...input.forecast_residual, [g]: input.forecast_residual[g].map((x, i) => i === day ? v : x) } }), 0, 10000)}</td><td>{shownFlow ? n(shownFlow.dispatch[g]) : '-'}</td><td>{shownFlow ? n(shownFlow.shortage[g]) : '-'}</td><td>{shownFlow ? n(shownFlow.fg_stock[g]) : '-'}</td></tr>)}</tbody></table></div>
        <p className="joint-note">This day: {lock ? lock.production ? 'exact production / reactor lock' : 'main-grade lock' : 'production unlocked'} / {purchaseLock ? `purchase locked at ${n(purchaseLock.tons)} t, arriving ${isoDay(input.plant.start_date, day + input.purchase_lead_days)}` : 'purchase unlocked'}. Grade-only locks leave quantities and reactors free. Freeze copies the last solved plan. Re-solve is required; conflicts can make the model infeasible.</p>
        {(input.day_locks.length > 0 || input.purchase_locks.length > 0) && <button className="button" disabled={disabled} onClick={() => patch({ day_locks: [], purchase_locks: [] })}><UnlockKeyhole size={15} />Clear all locks</button>}
      </section>
      {report && result && <details className="joint-audit"><summary>Solver stages, cost breakdown, plant rules & limitations</summary>
        <div className="joint-table-scroll"><table><thead><tr><th>Stage</th><th>Status</th><th>Incumbent</th><th>Best bound</th><th>Proof</th></tr></thead><tbody>{report.stages.map((s, i) => <tr key={i}><td>{s.goal}</td><td>{s.status}</td><td>{s.value === null ? '-' : n(s.goal === 'weighted_cost' ? s.value / 100000 : s.value, 2)}</td><td>{s.best_bound === null ? '-' : n(s.goal === 'weighted_cost' ? s.best_bound / 100000 : s.best_bound, 2)}</td><td>{s.proven_optimal ? 'Optimal' : 'Not proven'}</td></tr>)}</tbody></table></div>
        <p className="joint-note">Cost stage values are weighted preference scores, not invoices. Unweighted operating expense excludes shortage losses and the sunk purchase cost of opening stock / committed receipts.</p>
        <div className="joint-costs">{Object.entries(report.cost_breakdown).map(([k, value]) => <div key={k}><span>{label(k)}</span><strong>${n(value, 2)}</strong></div>)}</div>
        <h4>Factory rule checks / production fulfillment is not dispatch</h4><ul>{result.checks.map((c, i) => <li key={i}>{c.text}</li>)}</ul>
        <h4>Carry-over obligations</h4><p className="joint-note">{report.wip_releases_after_horizon.map(x => `${x.grade}: ${x.tons} t releases ${x.release_date}`).join(' / ') || 'No unreleased production'}. Reactor and campaign continuation is included in the solved JSON. Cleaning already underway at the next plan start is not yet supported.</p>
        <h4>Assumptions / confirm with company</h4><ul>{result.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </details>}
      <footer className="joint-footer"><span>No automatic write-back to ERP, shared daily mock Gantt or monthly risk plans.</span><button className="button" disabled={disabled} onClick={() => download(input, 'ube-integrated-input.json')}><Download size={15} />Export input JSON</button></footer>
    </>}
  </section>;
}
