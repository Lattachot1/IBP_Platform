'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DEMAND_DEFAULT,
  SAMPLE_PLAN,
  dispOf,
  slotOf,
  type OptimizeResult,
  type PlanDay,
} from './samplePlan';
import './optimize.css';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

type Phase = 'loading' | 'ok' | 'offline' | 'stale';

interface TipState {
  x: number;
  y: number;
  lines: string[];
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export default function OptimizePage() {
  const [data, setData] = useState<OptimizeResult | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [solving, setSolving] = useState(false);

  // Request inputs (the stub engine currently ignores everything except
  // demand; the Phase 2 CP-SAT engine consumes all of them).
  const [horizonDays, setHorizonDays] = useState(28);
  const [objective, setObjective] = useState('maximize_fulfilled');
  const [initGrade, setInitGrade] = useState('BR150');
  const [remainDays, setRemainDays] = useState(2);
  const [rx12Age, setRx12Age] = useState(54);
  const [rx34Age, setRx34Age] = useState(0);
  const [timeLimitS, setTimeLimitS] = useState(30);
  const [demand, setDemand] = useState<Record<string, number>>(DEMAND_DEFAULT);

  const [tip, setTip] = useState<TipState | null>(null);

  async function run() {
    setSolving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          horizon_days: horizonDays,
          objective,
          demand,
          time_limit_s: timeLimitS,
          initial: {
            grade: initGrade,
            remain_days: remainDays,
            rx12_age: rx12Age,
            rx34_age: rx34Age,
          },
        }),
      });
      if (!res.ok) throw new Error(`optimize API returned ${res.status}`);
      const json: OptimizeResult = await res.json();
      // Contract guard: a backend older than this page answers without the
      // per-reactor fields — show it as stale instead of crashing.
      if (!json.pair_notes || !json.days?.[0]?.reactors) {
        setData(SAMPLE_PLAN);
        setPhase('stale');
      } else {
        setData(json);
        setPhase('ok');
      }
    } catch {
      // Standalone fallback: identical data ships with the page, so the
      // planner can explore the mock plan without the backend running.
      setData(SAMPLE_PLAN);
      setPhase('offline');
    } finally {
      setSolving(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDemand(grade: string, raw: string) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    setDemand((prev) => ({ ...prev, [grade]: num }));
  }

  const STATUS_EN: Record<string, string> = { prod: 'Producing', clean: 'Cleaning', idle: 'Standby' };

  function showTip(e: React.MouseEvent, d: PlanDay, reactor?: { id: string; status: string }) {
    const lines = [`${d.date} · ${d.wd}${d.wknd ? ' · holiday' : ''}`];
    if (reactor) {
      lines.push(`${reactor.id} — today's status: ${STATUS_EN[reactor.status] ?? reactor.status}`);
    }
    d.parts.forEach((p) => {
      let line = `${dispOf(p.grade, data?.grades)}: ${fmt(p.tons)} t`;
      if (d.chg) line += ` (total ≤ ${fmt(d.cap ?? 0)})`;
      lines.push(line);
    });
    lines.push(`Reactor: ${d.rx}`);
    if (d.note) lines.push(d.note);
    setTip({
      x: Math.min(e.clientX + 14, window.innerWidth - 296),
      y: Math.min(e.clientY + 14, window.innerHeight - 150),
      lines,
    });
  }

  function dayBlocks(d: PlanDay) {
    return d.parts.map((p, k) => (
      <div
        key={p.grade + k}
        className={'opt-gblk' + (d.chg ? ' half' : '')}
        style={{
          background: `var(--s${slotOf(p.grade)})`,
          color: `var(--s${slotOf(p.grade)}i)`,
        }}
      >
        {d.chg
          ? `${dispOf(p.grade, data?.grades)}·${fmt(p.tons)}`
          : (
            <>
              {dispOf(p.grade, data?.grades)}
              <small>{fmt(p.tons)} t</small>
            </>
          )}
      </div>
    ));
  }

  const offline = phase === 'offline';

  return (
    <div className="opt-root">
      <header className="opt-header">
        <Link href="/" className="opt-back">← Dashboard</Link>
        <div className="opt-title">
          <h1>Production Optimization</h1>
          <div className="opt-sub">
            UBE IBP Platform · TSL — daily production plan for 6 product groups under grade-change, reactor-lifecycle and holiday rules
          </div>
        </div>
        <div className="opt-badges">
          {phase === 'ok' && data && (
            <span className="opt-badge live">
              <span className="opt-led" />
              {data.mode === 'sample' ? 'Engine stub · sample plan' : `Solver: ${data.mode}`}
              {' · '}
              {data.kpis.solve_s.toFixed(2)} s
            </span>
          )}
          {offline && (
            <span className="opt-badge warn">
              <span className="opt-led" />
              Offline — using the built-in sample plan
            </span>
          )}
          {phase === 'stale' && (
            <span className="opt-badge warn">
              <span className="opt-led" />
              Backend is an older version — restart python main.py, then press Run optimization
            </span>
          )}
          {phase === 'loading' && <span className="opt-badge">Connecting to backend…</span>}
        </div>
      </header>

      {data && (
        <div className="opt-shell">
          {/* ================= input rail ================= */}
          <aside className="opt-rail" aria-label="Plan parameters">
            <div className="opt-panel">
              <h2 className="opt-ph">Plan scope</h2>
              <div className="opt-field">
                <label htmlFor="opt-horizon">Horizon</label>
                <select
                  id="opt-horizon"
                  value={horizonDays}
                  onChange={(e) => setHorizonDays(Number(e.target.value))}
                >
                  <option value={14}>14 days</option>
                  <option value={28}>28 days</option>
                  <option value={56}>56 days</option>
                </select>
              </div>
              <div className="opt-field">
                <label htmlFor="opt-objective">Objective</label>
                <select
                  id="opt-objective"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                >
                  <option value="maximize_fulfilled">Maximize fulfilled demand</option>
                  <option value="minimize_changeover">Minimize changeover losses</option>
                  <option value="balance">Balance (adjustable weights)</option>
                </select>
              </div>
              <p className="opt-railnote">
                This stub always returns the same 28-day sample plan — every field here is consumed for real once the CP-SAT engine (Phase 2) replaces it.
              </p>
            </div>

            <div className="opt-panel">
              <h2 className="opt-ph">Initial state (first day of the plan)</h2>
              <div className="opt-fieldrow">
                <div className="opt-field">
                  <label htmlFor="opt-grade">Grade in production</label>
                  <select
                    id="opt-grade"
                    value={initGrade}
                    onChange={(e) => setInitGrade(e.target.value)}
                  >
                    {data.grades.map((g) => (
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
                    value={remainDays}
                    onChange={(e) => setRemainDays(Number(e.target.value) || 0)}
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
                    value={rx12Age}
                    onChange={(e) => setRx12Age(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="opt-field">
                  <label htmlFor="opt-rx34">RX3–4 age (production days)</label>
                  <input
                    id="opt-rx34"
                    type="number"
                    min={0}
                    value={rx34Age}
                    onChange={(e) => setRx34Age(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>

            <div className="opt-panel">
              <h2 className="opt-ph">Monthly demand (tons)</h2>
              {data.grades.map((g) => (
                <div className="opt-demandrow" key={g.id}>
                  <span className="opt-gcode">
                    <i
                      className="opt-dot"
                      style={{ background: `var(--s${g.slot})` }}
                    />
                    {g.disp}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={demand[g.id] ?? 0}
                    onChange={(e) => updateDemand(g.id, e.target.value)}
                    aria-label={`demand ${g.disp}`}
                  />
                </div>
              ))}
              <p className="opt-railnote">
                The stub recomputes fulfillment from these numbers immediately (the day-by-day plan stays fixed) — with the real engine these numbers will move the plan too.
              </p>
            </div>

            <div className="opt-panel">
              <h2 className="opt-ph">Calendar &amp; Solver</h2>
              <div className="opt-field">
                <label htmlFor="opt-holiday">Company holidays in horizon</label>
                <select id="opt-holiday" defaultValue="none">
                  <option value="none">None (weekends automatic)</option>
                  <option value="pick">Pick from calendar…</option>
                </select>
              </div>
              <div className="opt-fieldrow">
                <div className="opt-field">
                  <label htmlFor="opt-solver">Solver</label>
                  <select id="opt-solver" defaultValue="cpsat">
                    <option value="cpsat">CP-SAT (OR-Tools)</option>
                  </select>
                </div>
                <div className="opt-field">
                  <label htmlFor="opt-tlim">Time limit (s)</label>
                  <input
                    id="opt-tlim"
                    type="number"
                    min={5}
                    max={300}
                    value={timeLimitS}
                    onChange={(e) => setTimeLimitS(Number(e.target.value) || 30)}
                  />
                </div>
              </div>
              <button className="opt-runbtn" type="button" onClick={run} disabled={solving}>
                {solving ? 'Solving…' : 'Run optimization'}
              </button>
              {data && (
                <div className="opt-solverstat" style={{ marginTop: 10 }}>
                  <span className="opt-st">{data.kpis.status}</span>
                  <span className="mono">{data.kpis.solve_s.toFixed(2)} s</span>
                  <span>· mode: {data.mode}</span>
                </div>
              )}
            </div>
          </aside>

          {/* ================= main stage ================= */}
          <main className="opt-stage">
            <div className="opt-stagehead">
              <h1>{data.horizon_days}-Day Production Plan</h1>
              <span className="opt-title">
                <span className="opt-sub">
                  {data.start_date} · starts from {initGrade} · {offline ? 'built-in sample data' : 'live backend result'}
                </span>
              </span>
            </div>

            {offline && (
              <div className="opt-note">
                Cannot reach the backend (run <b>python main.py</b> in Backend/, then press Run optimization again) — below is the sample plan bundled with the page.
              </div>
            )}

            <div className="opt-kpis">
              <div className="opt-tile">
                <div className="opt-lab">Total production</div>
                <div className="opt-val">{fmt(data.kpis.total_tons)} <small>t</small></div>
                <div className="opt-foot">{data.horizon_days} days · avg {fmt(Math.round(data.kpis.total_tons / data.horizon_days))} t/day</div>
              </div>
              <div className="opt-tile">
                <div className="opt-lab">Fulfillment</div>
                <div className="opt-val">{data.kpis.fulfillment_pct.toFixed(1)}<small>%</small></div>
                <div className="opt-foot">Σ min(produced, demand) / Σ demand</div>
              </div>
              <div className="opt-tile">
                <div className="opt-lab">Shortage</div>
                <div className="opt-val">{fmt(data.kpis.shortage_tons)} <small>t</small></div>
                <div className="opt-foot">grades not scheduled in this plan</div>
              </div>
              <div className="opt-tile">
                <div className="opt-lab">Changeover days</div>
                <div className="opt-val">{data.kpis.changeover_days} <small>days</small></div>
                <div className="opt-foot">per the 11-pair transition table</div>
              </div>
              <div className="opt-tile">
                <div className="opt-lab">Solver</div>
                <div className="opt-val">{data.kpis.solve_s.toFixed(2)} <small>s</small></div>
                <div className="opt-foot">{data.kpis.status} · mode: {data.mode}</div>
              </div>
            </div>

            <section className="opt-panel" aria-label="Daily production Gantt">
              <h2 className="opt-ph">Daily production schedule — one row per reactor (Plant + RX1–RX4)</h2>
              <div className="opt-legend">
                {data.grades.map((g) => (
                  <span key={g.id}>
                    <i className="opt-dot" style={{ background: `var(--s${g.slot})` }} />
                    {g.disp}
                  </span>
                ))}
                <span>
                  <i
                    className="opt-dot"
                    style={{
                      background:
                        'repeating-linear-gradient(45deg, transparent 0 3px, var(--hatch) 3px 5px), var(--surface2)',
                      border: '1px solid var(--line)',
                    }}
                  />
                  Cleaning
                </span>
                <span>
                  <i
                    className="opt-dot"
                    style={{ border: '1px dashed var(--baseline)', background: 'transparent' }}
                  />
                  Standby (not yet used)
                </span>
              </div>
              <div className="opt-ganttwrap">
                <div className="opt-gantt">
                  <div className="opt-ghead">
                    <div className="opt-glabel" />
                    {data.days.map((d) => {
                      const parts = d.date.split(' ');
                      return (
                        <div key={d.iso} className={'opt-d' + (d.wknd ? ' wknd' : '')}>
                          <b>{parts[0]}</b>
                          {parts.slice(1).join(' ')} · {d.wd}
                        </div>
                      );
                    })}
                  </div>
                  <div className="opt-grow">
                    <div className="opt-glabel">Plant</div>
                    {data.days.map((d) => (
                      <div
                        key={'plant-' + d.iso}
                        className={'opt-gcell' + (d.wknd ? ' wknd' : '')}
                        onMouseMove={(e) => showTip(e, d)}
                        onMouseLeave={() => setTip(null)}
                      >
                        {dayBlocks(d)}
                      </div>
                    ))}
                    {['RX1', 'RX2', 'RX3', 'RX4'].map((rid) => (
                      <Fragment key={rid}>
                        <div className="opt-glabel">{rid}</div>
                        {data.days.map((d) => {
                          const reactor = d.reactors?.find((r) => r.id === rid);
                          const status = reactor?.status ?? 'prod';
                          return (
                            <div
                              key={d.iso}
                              className={'opt-gcell' + (d.wknd ? ' wknd' : '')}
                              onMouseMove={(e) => showTip(e, d, { id: rid, status })}
                              onMouseLeave={() => setTip(null)}
                            >
                              {status === 'prod'
                                ? dayBlocks(d)
                                : (
                                  <div className={'opt-gblk state-' + status}>
                                    {status === 'clean' ? 'Cleaning' : 'Standby'}
                                  </div>
                                )}
                            </div>
                          );
                        })}
                        {(rid === 'RX2' || rid === 'RX4') && (
                          <div className="opt-lanecap opt-paircap">
                            {rid === 'RX2' ? data.pair_notes?.['RX1-2'] : data.pair_notes?.['RX3-4']}
                          </div>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </div>
              <p className="opt-gcap">
                Plant row = plant-level grade for the day · RX1–RX4 rows = per-reactor status (producing / cleaning / standby) · two-tone block = changeover day (uses the special ceiling of that pair) · grey columns = Sat–Sun (production allowed, but no VCR→BR150 change)
              </p>
            </section>

            <section className="opt-panel" aria-label="Demand fulfillment">
              <h2 className="opt-ph">Fulfillment by grade (produced vs 28-day demand)</h2>
              {data.fulfillment.map((r) => {
                const pct = r.demand > 0 ? Math.min(r.produced / r.demand, 1) * 100 : 0;
                return (
                  <div className="opt-frow" key={r.grade}>
                    <span className="opt-gcode">
                      <i className="opt-dot" style={{ background: `var(--s${r.slot})` }} />
                      {r.disp}
                    </span>
                    <div className="opt-ftrack">
                      <div
                        className="opt-ffill"
                        style={{ width: `${pct.toFixed(1)}%`, background: `var(--s${r.slot})` }}
                      />
                    </div>
                    <span className="opt-fmeta">
                      {fmt(r.produced)} / {fmt(r.demand)} t ·{' '}
                      {r.shortage > 0
                        ? <span className="opt-short">short {fmt(r.shortage)}</span>
                        : `+${fmt(r.produced - r.demand)}`}
                    </span>
                  </div>
                );
              })}
            </section>

            <section className="opt-panel" aria-label="Constraint check results">
              <h2 className="opt-ph">Constraint check</h2>
              <ul className="opt-checks">
                {data.checks.map((c, i) => (
                  <li key={i}>
                    <span className={`opt-mk ${c.level}`}>{c.level === 'ok' ? '✓' : '⚠'}</span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="opt-panel opt-details" aria-label="Day-by-day table">
              <details className="opt-details">
                <summary>Full day-by-day plan ({data.days.length} rows)</summary>
                <div className="opt-twrap">
                  <table className="opt-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Grades (tons)</th>
                        <th>Type</th>
                        <th>Reactor</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.days.map((d) => (
                        <tr key={d.iso}>
                          <td className={'mono' + (d.wknd ? ' wknd' : '')}>{d.date} · {d.wd}</td>
                          <td className="mono">
                            {d.parts
                              .map((p, k) => {
                                let seg = `${dispOf(p.grade, data.grades)} ${fmt(p.tons)}`;
                                if (d.chg && k === d.parts.length - 1 && d.parts.length > 1) {
                                  seg += ` ≤ total ${fmt(d.cap ?? 0)}`;
                                }
                                return seg;
                              })
                              .join(' + ')}
                          </td>
                          <td>
                            <span className={`opt-chip ${d.chg ? 'chg' : 'run'}`}>
                              {d.chg ? 'Changeover' : 'Production'}
                            </span>
                          </td>
                          <td className="mono">{d.rx}</td>
                          <td className={d.wknd ? 'wknd' : ''}>{d.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>

            <section className="opt-panel opt-assump" aria-label="Assumptions">
              <b>Optimizer assumptions (pending confirmation from production)</b>
              <ul>
                {data.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </section>
          </main>
        </div>
      )}

      {phase === 'loading' && (
        <div className="opt-loading">
          <div className="opt-panel">
            <h2 className="opt-ph">Loading</h2>
            Calling <span className="mono">POST {API_BASE_URL}/api/v1/optimize</span> …
            (if the backend is not running, the page falls back to the built-in sample plan automatically)
          </div>
        </div>
      )}

      {tip && (
        <div className="opt-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.lines.map((l, i) =>
            i === 0 ? <b key={i}>{l}</b> : <div key={i}>{l}</div>
          )}
        </div>
      )}
    </div>
  );
}
