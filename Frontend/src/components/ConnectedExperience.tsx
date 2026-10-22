'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarRange, Check, Download, Factory, Focus, Globe2, Layers3, Moon, Orbit, Package, Pause, Play, RotateCcw, Ship, Sun, Timer, Undo2, Redo2, Waves } from 'lucide-react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useScenario } from './ScenarioContext';
import { bestAdjacentSwap, copyScenario, delayedReceipt, evaluateScenario, type ScenarioSnapshot } from '../lib/connectedScenario';
import { reactorSnapshot } from '../lib/executiveDemo';
import { dayLabel, port, shipmentState } from '../lib/logisticsDemo';

const FactoryTwin = dynamic(() => import('./FactoryTwin'), { ssr: false });
const WorldGlobe = dynamic(() => import('./WorldGlobe'), { ssr: false });
type Navigate = (view: 'executive' | 'timeline' | 'logistics' | 'lab' | 'factory') => void;
const n = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const money = (value: number) => `$${n(value / 1e6, 2)}M`;
const delta = (value: number, suffix = '') => `${value > 0 ? '+' : ''}${n(value, 1)}${suffix}`;
function Tool({ label, onClick, pressed, disabled, children }: { label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return <button className="icon-button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>;
}
export function ConnectedScenarioBar({ navigate, readOnly = false }: { navigate: Navigate; readOnly?: boolean }) {
  const s = useScenario();
  const [receipt, setReceipt] = useState(s.plan.purchases[0]?.id || '');
  const selected = s.plan.purchases.find(p => p.id === receipt) || s.plan.purchases[0];
  const delay = () => { if (!selected) return; const next = delayedReceipt(s.state, selected.id, 7); s.commit(next, `${selected.id}: counterfactual receipt +7 days`); const changed = evaluateScenario(next).evaluation.daily.find(d => d.produced < s.current.evaluation.daily[d.day].produced); s.setDay(changed?.day || Math.min(67, selected.start)); };
  const deferred = s.plan.purchases.filter(p => p.start >= s.plan.days).reduce((sum, p) => sum + p.tons, 0);
  return <section className="connected-bar" aria-label="Shared scenario controls">
    <div className="connected-identity"><span className="tiny-dot" /><strong>ONE SHARED SCENARIO</strong><small>R{s.revision} / {s.previewPlan ? 'LIVE PREVIEW' : 'MOCK'}</small></div>
    <div className="connected-controls">
      <select aria-label="Linked raw material shipment" value={selected?.id || ''} onChange={e => setReceipt(e.target.value)}>{s.plan.purchases.map(p => <option key={p.id} value={p.id}>{p.id} / {n(p.tons)} t</option>)}</select>
      <button className="button" disabled={readOnly || !selected || !!s.previewPlan} onClick={delay}><Timer size={15} />Delay vessel +7d</button>
      <Tool label="Undo shared scenario" onClick={s.undo} disabled={readOnly || !s.canUndo || !!s.previewPlan}><Undo2 size={16} /></Tool>
      <Tool label="Redo shared scenario" onClick={s.redo} disabled={readOnly || !s.canRedo || !!s.previewPlan}><Redo2 size={16} /></Tool>
      <Tool label="Reset shared scenario" disabled={readOnly} onClick={() => { if (window.confirm('Reset all shared planning, shipment and assumption edits?')) s.reset(); }}><RotateCcw size={16} /></Tool>
      <Tool label="Export shared scenario" onClick={s.exportScenario} disabled={!!s.previewPlan}><Download size={16} /></Tool>
      <button className="button dark" onClick={() => navigate('timeline')}><CalendarRange size={15} />Edit shared Gantt</button>
      <button className="button" onClick={() => navigate('lab')}><Layers3 size={15} />Objective priorities</button>
      <button className="button" onClick={() => navigate('factory')}><Factory size={15} />Factory schedule</button>
    </div>
    <div className="connected-status"><span role="status">{readOnly ? 'Shared draft retained. Replay frames are previews until applied.' : s.notice}</span><span>No OT / {s.assumptions.lag} calendar-day release lag / 7-day evaluation tail</span></div>
    {deferred > 0 && <p className="connected-caution">{n(deferred)} t of receipts beyond the evaluation horizon. Excluded acquisition/freight is deferred exposure, not savings.</p>}
  </section>;
}
function Metrics({ outcome, baseline }: { outcome: ReturnType<typeof evaluateScenario>; baseline: ReturnType<typeof evaluateScenario> }) {
  const rows = [
    { label: 'Modeled cost / penalty excluded', value: money(outcome.costExcludingPenalty), change: delta((outcome.costExcludingPenalty - baseline.costExcludingPenalty) / 1000, 'k USD'), id: 'exec-cost' },
    { label: 'Factory dispatch fulfilment', value: `${n(outcome.evaluation.service, 1)}%`, change: delta(outcome.evaluation.service - baseline.evaluation.service, ' pp'), id: 'exec-service' },
    { label: 'Unserved demand / lost sales', value: `${n(outcome.evaluation.totalShortage)} t`, change: delta(outcome.evaluation.totalShortage - baseline.evaluation.totalShortage, ' t'), id: 'linked-shortage' },
    { label: 'Rule conflicts / unverified feasibility', value: String(outcome.evaluation.issues.filter(i => i.severity === 'conflict').length), change: 'Day-level findings; not an approved plan', id: 'linked-conflicts' },
  ];
  return <div className="linked-metrics">{rows.map(r => <div key={r.id}><span>{r.label}</span><strong data-testid={r.id}>{r.value}</strong><small>{r.change}{r.id !== 'linked-conflicts' && ' vs original mock'}</small></div>)}</div>;
}
function Flow({ snapshot, current, day }: { snapshot: ScenarioSnapshot; current: ReturnType<typeof evaluateScenario>; day: number }) {
  const balance = current.evaluation.daily[day];
  const arrived = snapshot.plan.purchases.filter(p => p.start <= day).reduce((sum, p) => sum + p.tons, 0);
  const campaign = snapshot.plan.campaigns.filter(c => day >= c.start && day < c.start + c.duration);
  return <div className="decision-flow" aria-label="Connected decision pipeline">{[
    { icon: Ship, title: 'Inbound receipts', value: `${n(arrived)} t arrived` },
    { icon: Waves, title: 'Raw material', value: `${n(balance.raw)} t stock` },
    { icon: Factory, title: 'Factory', value: `${n(balance.produced)} t today` },
    { icon: CalendarRange, title: 'Campaign', value: campaign.map(c => c.grade).join(' + ') || 'No production' },
    { icon: Package, title: 'Dispatch', value: `${n(balance.delivered)} t today` },
  ].map((node, i) => <div key={node.title}><node.icon size={20} /><span><small>{node.title}</small><strong>{node.value}</strong></span>{i < 4 && <ArrowRight size={16} />}</div>)}</div>;
}
function FactoryStage({ snapshot, outcome, day }: { snapshot: ScenarioSnapshot; outcome: ReturnType<typeof evaluateScenario>; day: number }) {
  const [selected, setSelected] = useState('RX1'), [view, setView] = useState<'plant' | 'top'>('plant'), [lighting, setLighting] = useState<'day' | 'night'>('day'), [orbit, setOrbit] = useState(false), [reset, setReset] = useState(0);
  const reactors = useMemo(() => reactorSnapshot(snapshot.plan, outcome.evaluation, day), [snapshot.plan, outcome.evaluation, day]);
  const daily = outcome.evaluation.daily[day], reactor = reactors.find(r => r.id === selected)!;
  return <div className="exec-plant-layout">
    <div className="exec-plant-stage" data-atmosphere={lighting}>
      <FactoryTwin reactors={reactors} raw={daily.raw} fg={daily.fg} producing={daily.produced} selected={selected} view={view} reset={reset} atmosphere={lighting} orbit={orbit} onSelect={setSelected} />
      <div className="exec-plant-overlay"><span><Factory size={14} />CONNECTED MOCK / CONCEPTUAL FACTORY</span><div>
        <Tool label={lighting === 'day' ? 'Switch to night lighting' : 'Switch to day lighting'} pressed={lighting === 'night'} onClick={() => setLighting(v => v === 'day' ? 'night' : 'day')}>{lighting === 'day' ? <Moon size={17} /> : <Sun size={17} />}</Tool>
        <Tool label="Orbit factory camera" pressed={orbit} onClick={() => setOrbit(v => !v)}><Orbit size={17} /></Tool>
        <Tool label="Top-down factory view" pressed={view === 'top'} onClick={() => setView(v => v === 'top' ? 'plant' : 'top')}><Layers3 size={17} /></Tool>
        <Tool label="Reset factory camera" onClick={() => setReset(v => v + 1)}><Focus size={17} /></Tool>
      </div></div>
      <div className="exec-plant-date"><strong>{dayLabel(day)} 2026</strong><span>Shared end-of-day snapshot</span></div>
      <div className="exec-plant-legend"><span><i />Producing</span><span><i className="cleaning" />Cleaning</span><span><i className="hold" />Material hold</span><span>Not live telemetry</span></div>
    </div>
    <aside className="exec-reactor-inspector"><span className="eyebrow">REACTOR STATE</span><h3>{selected}</h3><span className="exec-reactor-state">{reactor.status}</span><div className="exec-reactor-detail"><span>Pair<strong>{reactor.pair}</strong></span><span>Operating age<strong>{reactor.age} days</strong></span><span>Raw stock<strong data-testid="factory-raw">{n(daily.raw)} t</strong></span><span>Credited production<strong>{n(daily.produced)} t</strong></span><span>FG stock<strong>{n(daily.fg)} t</strong></span></div><div className="exec-reactor-picker">{reactors.map(r => <button key={r.id} aria-label={`Select ${r.id} reactor`} aria-pressed={selected === r.id} onClick={() => setSelected(r.id)}><i className={r.status.replace(/ /g, '-').toLowerCase()} />{r.id}<span>{r.status}</span></button>)}</div><small>Illustrative equipment. Rule coverage is incomplete.</small></aside>
  </div>;
}
function OrderImpact({ outcome, baseline }: { outcome: ReturnType<typeof evaluateScenario>; baseline: ReturnType<typeof evaluateScenario> }) {
  const [all, setAll] = useState(false);
  const rows = outcome.orders.map(o => ({ ...o, before: baseline.orders.find(b => b.id === o.id) }));
  const changed = rows.filter(o => o.unserved > 0 || Math.abs(o.fulfilled - (o.before?.fulfilled || 0)) > 1e-6 || o.start !== o.before?.start || Math.abs(o.required - (o.before?.required || 0)) > 1e-6);
  return <section className="linked-orders"><div className="section-heading"><div><span className="eyebrow">CUSTOMER IMPACT / FACTORY DISPATCH</span><h2>Which commitments change?</h2></div><label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />All orders</label></div><div className="linked-table-scroll"><table><thead><tr><th>Order / grade</th><th>Dispatch due</th><th>Required</th><th>Fulfilled</th><th>Unserved</th><th>Change vs original</th></tr></thead><tbody>{(all ? rows : changed).map(o => <tr key={o.id}><td><strong>{o.grade}</strong><small>{o.id}</small></td><td>{dayLabel(o.start)}{o.start !== o.before?.start && <small className="linked-risk">Edited date; not original-date service</small>}</td><td>{n(o.required)} t</td><td>{n(o.fulfilled)} t</td><td className={o.unserved > 0 ? 'linked-risk' : ''}>{n(o.unserved)} t</td><td className={o.fulfilled < (o.before?.fulfilled || 0) ? 'linked-risk' : ''}>{delta(o.fulfilled - (o.before?.fulfilled || 0), ' t')}{o.required !== o.before?.required && <small>Required quantity changed</small>}</td></tr>)}</tbody></table></div>{!changed.length && !all && <p className="linked-note">No shortage or changed order allocations.</p>}<p className="linked-note">Same-day/grade dispatch is allocated in order-list order. Unserved volume is lost sales, not backlog. Ocean customer arrivals are separate from these factory dispatch deadlines.</p></section>;
}
export function ConnectedCockpit({ active, navigate }: { active: boolean; navigate: Navigate }) {
  const s = useScenario(), [playing, setPlaying] = useState(false);
  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => { if (!playing) return; const timer = setInterval(() => s.setDay(day => Math.min(s.plan.days - 1, day + 1)), 750); return () => clearInterval(timer); }, [playing, s.plan.days]);
  useEffect(() => { if (s.day === s.plan.days - 1) setPlaying(false); }, [s.day, s.plan.days]);
  const snapshot = { ...s.state, plan: s.effectivePlan };
  const recovery = useMemo(() => bestAdjacentSwap(s.state), [s.state]);
  const chart = s.current.evaluation.daily.map((d, i) => ({ date: dayLabel(i), raw: d.raw, fg: d.fg, original: s.baseline.evaluation.daily[i].fg, unserved: d.shortage }));
  if (!active) return null;
  return <div className="connected-cockpit">
    <Flow snapshot={snapshot} current={s.current} day={s.day} />
    <FactoryStage snapshot={snapshot} outcome={s.current} day={s.day} />
    <div className="linked-clock"><Tool label={playing ? 'Pause factory timeline' : 'Play factory timeline'} onClick={() => { if (s.day === s.plan.days - 1) s.setDay(0); setPlaying(v => !v); }}>{playing ? <Pause size={17} /> : <Play size={17} />}</Tool><input type="range" min="0" max={s.plan.days - 1} value={s.day} aria-label="Factory snapshot day" onChange={e => { setPlaying(false); s.setDay(Number(e.target.value)); }} /><span>{dayLabel(s.day)}</span></div>
    <Metrics outcome={s.current} baseline={s.baseline} />
    <div className="linked-shocks"><button className="button" onClick={() => s.setAssumptions(a => ({ ...a, monthlyPrices: Object.fromEntries(Object.entries(s.seed.assumptions.monthlyPrices).map(([month, price]) => [month, price * 1.25])) }))}><Waves size={15} />BD price jump +25%</button><button className="button" onClick={() => s.setAssumptions(a => ({ ...a, demandChange: 20 }))}><Package size={15} />Demand stress +20%</button><button className="icon-button" title="Restore price and demand assumptions" aria-label="Restore price and demand assumptions" onClick={() => s.setAssumptions(a => ({ ...a, monthlyPrices: copyScenario(s.seed.assumptions.monthlyPrices), demandChange: s.seed.assumptions.demandChange }))}><RotateCcw size={16} /></button></div>
    <div className="linked-action-band"><div><span className="eyebrow">RESPONSE LAB / NOT SOLVER-OPTIMAL</span><h2>Change the schedule. Keep the consequences.</h2><p>{recovery.tested} adjacent campaign swaps tested. {recovery.improved ? `${n(s.current.evaluation.totalShortage - recovery.outcome.evaluation.totalShortage)} t less unserved demand in the best tested candidate.` : 'No tested swap improves the service/cost ordering without increasing rule conflicts.'}</p></div><div><button className="button" onClick={() => navigate('timeline')}><CalendarRange size={16} />Edit shared Gantt</button><button className="button dark" disabled={!recovery.improved || !!s.previewPlan} onClick={() => s.commit(recovery.snapshot, 'Best tested adjacent swap applied; still unverified')}><Check size={16} />Apply tested swap</button></div></div>
    <section className="linked-chart"><div className="section-heading"><div><span className="eyebrow">DAILY CONSEQUENCES</span><h2>Stock, production and commitments</h2></div><span className="source-badge">Original FG / shared FG / raw stock / unserved</span></div><div style={{ height: 290 }}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart}><CartesianGrid stroke="#e4ebe6" vertical={false} /><XAxis dataKey="date" minTickGap={50} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Area isAnimationActive={false} dataKey="fg" name="Shared FG (t)" fill="#d8eee2" stroke="#339b78" /><Line isAnimationActive={false} dataKey="original" name="Original FG (t)" stroke="#9eaea6" strokeDasharray="4 4" dot={false} /><Line isAnimationActive={false} dataKey="raw" name="Raw stock (t)" stroke="#6599b2" dot={false} /><Bar isAnimationActive={false} dataKey="unserved" name="Unserved (t)" fill="#d59269" /></ComposedChart></ResponsiveContainer></div></section>
    <section className="linked-costs"><h2>Modeled cost composition</h2><div>{Object.entries(s.current.evaluation.costBreakdown).map(([key, value]) => <span key={key}><small>{key.replace(/([A-Z])/g, ' $1')}</small><strong>${n(value)}</strong></span>)}</div><p className="linked-note">Headline excludes the separate shortage penalty. Freight counts inbound receipts within evaluation and actually fulfilled outbound dispatches. Lower production or missing sales are not financial savings; revenue and supplier confirmation are not modeled.</p></section>
    <OrderImpact outcome={s.current} baseline={s.baseline} />
  </div>;
}
export function ConnectedLogistics({ active }: { active: boolean }) {
  const s = useScenario(), [selected, setSelected] = useState(''), [filter, setFilter] = useState<'all' | 'inbound' | 'outbound'>('all'), [rotating, setRotating] = useState(false), [focus, setFocus] = useState({ port: 'th', revision: 0 });
  const shipments = s.current.shipments;
  const visible = shipments.filter(row => filter === 'all' || row.direction === filter);
  const current = visible.find(row => row.id === selected) || visible[0];
  const original = current && s.baseline.shipments.find(row => row.id === current.id);
  const edit = (key: 'departure' | 'transitDays' | 'tons' | 'freightPerTon', value: number) => {
    if (!current || current.direction !== 'inbound' || !Number.isFinite(value)) return;
    const next = copyScenario(s.state), id = current.id.slice(3), receipt = next.plan.purchases.find(p => p.id === id)!;
    const route = next.routes[id] || { origin: current.origin, transitDays: current.transitDays, freightPerTon: current.freightPerTon };
    if (key === 'tons') receipt.tons = Math.max(1, Math.min(10000, value));
    if (key === 'freightPerTon') route.freightPerTon = Math.max(0, Math.min(2000, value));
    if (key === 'departure') receipt.start = Math.max(0, Math.round(value) + route.transitDays);
    if (key === 'transitDays') { route.transitDays = Math.max(1, Math.min(90, Math.round(value))); receipt.start = Math.max(0, current.departure + route.transitDays); }
    next.routes[id] = route; s.commit(next, `${current.id}: ${key} updated across the shared scenario`);
  };
  if (!active) return null;
  return <div className="logistics-studio connected-logistics"><div className="logistics-toolbar"><div className="logistics-segments" role="group" aria-label="Shipment direction">{(['all', 'inbound', 'outbound'] as const).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? <Globe2 size={15} /> : f === 'inbound' ? <Waves size={15} /> : <Package size={15} />}{f}</button>)}</div><span className="logistics-provenance">CONNECTED MOCK / FACTORY DISPATCH-BASED CARGO</span></div>
    <Metrics outcome={s.current} baseline={s.baseline} />
    <section className="logistics-world"><div className="globe-stage"><div className="globe-overlay-top"><div><span className="globe-eyebrow">SHARED SUPPLY NETWORK</span><h2>Every receipt reaches the plan.</h2><span className="globe-date">{dayLabel(s.day)} 2026</span></div><div className="globe-controls"><Tool label="Auto rotate globe" pressed={rotating} onClick={() => setRotating(v => !v)}><Globe2 size={17} /></Tool><Tool label="Focus Thailand hub" onClick={() => setFocus(v => ({ port: 'th', revision: v.revision + 1 }))}><Focus size={17} /></Tool></div></div><WorldGlobe shipments={visible} day={s.day} delay={0} selected={current?.id || ''} rotating={rotating} focus={focus} onSelect={setSelected} /><div className="globe-legend"><span><i className="inbound" />Raw material</span><span><i className="outbound" />Fulfilled dispatch</span></div><div className="globe-footnote">Schematic great-circle links / not vessel tracking or navigable sea routes</div></div>
      <aside className="shipment-inspector">{current ? <><span className="eyebrow">LINKED SHIPMENT</span><h3>{current.product}</h3><small>{current.id}</small><p>{port(current.origin).name} → {port(current.destination).name}</p><div className="route-state"><strong>{shipmentState(current, s.day, 0).status}</strong></div><label className="linked-select">Shipment<select aria-label="Inspect linked shipment" value={current.id} onChange={e => setSelected(e.target.value)}>{visible.map(row => <option key={row.id} value={row.id}>{row.id} / {row.product}</option>)}</select></label>
        <div className="route-arrival"><span>Shared receipt / ocean arrival</span><strong data-testid="scenario-arrival">{dayLabel(current.departure + current.transitDays)}</strong><small>Original: {original ? dayLabel(original.departure + original.transitDays) : 'New event'}</small></div>
        {current.direction === 'inbound' ? <><div className="route-edit-grid">{[{ key: 'departure' as const, label: 'Shipment departure day', value: current.departure, min: -90, max: 120 }, { key: 'transitDays' as const, label: 'Shipment transit days', value: current.transitDays, min: 1, max: 90 }, { key: 'tons' as const, label: 'Shipment quantity', value: current.tons, min: 1, max: 10000 }, { key: 'freightPerTon' as const, label: 'Shipment freight rate', value: current.freightPerTon, min: 0, max: 2000 }].map(field => <label key={field.key}>{field.label}<input type="number" aria-label={field.label} min={field.min} max={field.max} value={field.value} onChange={e => edit(field.key, Number(e.target.value))} /></label>)}</div><button className="button dark" onClick={() => s.commit(delayedReceipt(s.state, current.id.slice(3), 7), `${current.id}: receipt delayed 7 days`)}><Timer size={15} />Delay this vessel +7d</button></> : <p className="linked-note">{n(current.tons)} t of fulfilled factory dispatch. Edit the production / order plan in Gantt; outbound cargo is derived, not independently editable.</p>}</> : <p className="linked-note">No shipments in this direction. Unserved demand does not create outbound cargo.</p>}</aside>
    </section><div className="linked-clock"><label>Shared snapshot</label><input type="range" aria-label="Network snapshot day" min="0" max={s.plan.days - 1} value={s.day} onChange={e => s.setDay(Number(e.target.value))} /><span>{dayLabel(s.day)}</span></div><Flow snapshot={{ ...s.state, plan: s.effectivePlan }} current={s.current} day={s.day} />
    <div className="linked-table-scroll"><table><thead><tr><th>Shipment</th><th>Origin → destination</th><th>Cargo</th><th>Arrival</th><th>Change vs original</th></tr></thead><tbody>{visible.map(row => { const before = s.baseline.shipments.find(b => b.id === row.id), arrival = row.departure + row.transitDays; return <tr key={row.id} onClick={() => setSelected(row.id)}><td><button className="linked-row-button" onClick={() => setSelected(row.id)}>{row.id}</button></td><td>{port(row.origin).name} → {port(row.destination).name}</td><td>{n(row.tons)} t</td><td>{dayLabel(arrival)}</td><td className={before && arrival > before.departure + before.transitDays ? 'linked-risk' : ''}>{before ? delta(arrival - before.departure - before.transitDays, ' d') : 'New fulfilled cargo'}</td></tr>; })}</tbody></table></div><p className="linked-note">Inbound arrival equals the same receipt date in Gantt. Outbound departure is the factory dispatch date; customer arrival adds mock transit. Port coordinates, counterparties, routes, freight and all quantities are illustrative. No actual shipping integrations.</p>
  </div>;
}
