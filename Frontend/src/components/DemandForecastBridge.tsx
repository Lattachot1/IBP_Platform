'use client';

import { useEffect, useRef, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import { forecastSourceCurrent, pilotApi, type ForecastAvailability, type ForecastSource, type IntegratedInput } from '../lib/integratedPlanning';

const n = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
export function DemandForecastBridge({ input, disabled, onStart, onLoaded, onError, onFinish }: {
  input: IntegratedInput; disabled: boolean; onStart: () => void; onLoaded: (input: IntegratedInput) => void;
  onError: (message: string) => void; onFinish: () => void;
}) {
  const [available, setAvailable] = useState<ForecastAvailability | null>(null);
  const [statusError, setStatusError] = useState('');
  const [path, setPath] = useState<ForecastSource['path']>(input.demand_source?.path || 'point');
  const [allocation, setAllocation] = useState<ForecastSource['allocation']>(input.demand_source?.allocation || 'calendar_days');
  const [partial, setPartial] = useState<ForecastSource['partial_month_policy']>(input.demand_source?.partial_month_policy || 'prorate');
  const [firm, setFirm] = useState<ForecastSource['firm_orders_mode']>(input.demand_source?.firm_orders_mode || 'preserve');
  const mounted = useRef(true);
  async function refresh() {
    try { const next = await pilotApi<ForecastAvailability>('demand-forecast/status'); if (mounted.current) { setAvailable(next); setStatusError(''); } }
    catch (e) { if (mounted.current) { setAvailable(null); setStatusError(String(e)); } }
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const source = input.demand_source;
    if (source) { setPath(source.path); setAllocation(source.allocation); setPartial(source.partial_month_policy); setFirm(source.firm_orders_mode); }
  }, [input.demand_source?.snapshot_id]);
  async function load() {
    onStart();
    try {
      const next = await pilotApi<IntegratedInput>('demand-forecast', { input, path, allocation, partial_month_policy: partial, firm_orders_mode: firm });
      onLoaded(next);
      if (mounted.current) setStatusError('');
    } catch (e) { onError(String(e)); }
    finally { onFinish(); }
  }
  const source = input.demand_source;
  const current = forecastSourceCurrent(input);
  return <section className="joint-forecast-source" aria-label="Real demand forecast bridge">
    <header className="joint-section-title"><div><span className="eyebrow">DEMAND SOURCE / BILLING-TRAINED MODELS</span><h3>Demand Forecast → Planning input</h3></div><div className="joint-actions">
      <button className="icon-button" aria-label="Refresh demand model availability" title="Refresh demand models" disabled={disabled} onClick={() => void refresh()}><RefreshCw size={16} /></button>
      <button className="button green" disabled={disabled} onClick={() => void load()}><Link2 size={15} />Load real demand forecast</button>
    </div></header>
    <div className="joint-input-grid">
      <label className="joint-field"><span>Forecast path</span><select aria-label="Demand forecast path" disabled={disabled} value={path} onChange={e => setPath(e.target.value as typeof path)}><option value="point">Point forecast</option><option value="lower">Lower band path</option><option value="upper">Upper band path</option></select></label>
      <label className="joint-field"><span>Daily allocation assumption</span><select aria-label="Demand daily allocation" disabled={disabled} value={allocation} onChange={e => setAllocation(e.target.value as typeof allocation)}><option value="calendar_days">Calendar days</option><option value="working_days">Weekdays, no holidays</option></select></label>
      <label className="joint-field"><span>Partial calendar months</span><select aria-label="Demand partial month policy" disabled={disabled} value={partial} onChange={e => setPartial(e.target.value as typeof partial)}><option value="prorate">Prorate eligible days</option><option value="reject">Full months only</option></select></label>
      <label className="joint-field"><span>Existing firm orders</span><select aria-label="Demand firm order mode" disabled={disabled} value={firm} onChange={e => setFirm(e.target.value as typeof firm)}><option value="preserve">Keep entered orders</option><option value="clear">Clear mapped orders</option></select></label>
    </div>
    {statusError ? <p className="joint-note">Model availability unavailable: {statusError}. No demo forecast is substituted.</p> : available ? <p className="joint-note" data-testid="forecast-coverage">Live models: {available.models.map(m => m.grade).join(', ') || 'none'} / manual grades: {available.manual_grades.join(', ') || 'none'}. Earliest shared forecast month: {available.earliest_common_month || 'unavailable'}.</p> : <p className="joint-note">Checking demand model availability...</p>}
    <p className="joint-note">Residual = max(allocated window forecast − firm orders in the same month/window, 0). Daily buckets are planning assumptions, not daily forecasts. Existing orders may be demo inputs. Partial-month allocation does not net earlier actual shipments. Loading replaces mapped demand only; stock, BD prices, factory state and locks are retained. Solve separately to apply the new demand to a plan.</p>
    {source ? <>
      <p className={'joint-source-status ' + (current ? '' : 'modified')} data-testid="demand-source-status">{current ? `${source.grades.length} grades from captured live forecast / ${source.manual_grades.length} manual grades` : 'Demand edited since forecast snapshot / manual override'}<small>Snapshot {source.snapshot_id.slice(0, 12)} / {source.path} / {source.allocation} / captured {new Date(source.captured_at).toLocaleString()} / model training {new Date(source.trained_at).toLocaleString()}</small></p>
      {!current && !source.manual_override_acknowledged && <div className="joint-note">Edited demand is not reconciled with this snapshot. Reload the forecast, or <button className="button" disabled={disabled} onClick={() => onLoaded({ ...input, demand_source: { ...source, status: 'modified', manual_override_acknowledged: true } })}>Accept edited demand as manual</button></div>}
      {!current && source.manual_override_acknowledged && <p className="joint-note">Manual demand override explicitly accepted. Snapshot figures below are historical provenance, not the current edited demand.</p>}
      <details className="joint-forecast-audit"><summary>Forecast provenance & monthly-to-daily reconciliation</summary>
        <div className="joint-table-scroll"><table><thead><tr><th>Grade / champion</th><th>Month</th><th>Monthly point / lower / upper (t)</th><th>Selected window (t)</th><th>Firm retained (t)</th><th>Residual (t)</th></tr></thead><tbody>{source.grades.flatMap(g => g.months.map(m => <tr key={g.grade + m.period}><td><strong>{g.grade}</strong><small>{g.model_name}<br />Trained through {g.trained_through} / nominal interval {g.interval_level_pct}% / measured coverage {g.coverage_empirical === null ? 'unavailable' : n(g.coverage_empirical * 100) + '%'}</small></td><td>{m.period}<small>h={m.horizon_step} / {m.eligible_days_in_window}/{m.eligible_days_in_month} eligible days{m.partial_month ? ' / partial' : ''}</small></td><td>{n(m.point_tons)} / {n(m.lower_tons)} / {n(m.upper_tons)}</td><td>{n(m.target_window_tons)}</td><td>{n(m.firm_window_tons)}</td><td>{n(m.residual_window_tons)}</td></tr>))}</tbody></table></div>
        <ul>{source.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
      </details>
    </> : <p className="joint-source-status" data-testid="demand-source-status">No live demand snapshot applied / current demand remains manual or demo.</p>}
  </section>;
}
