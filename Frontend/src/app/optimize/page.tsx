'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  DEMAND_DEFAULT,
  GRADES,
  SAMPLE_PLAN,
  dispOf,
  slotOf,
  type OptimizeResult,
  type PlanDay,
} from './samplePlan';
import {
  CLEAN_DAYS,
  PAIRS,
  addCleaning,
  campaignStarts,
  cleaningAt,
  conflictCount,
  conflictDaysOf,
  draftFromResult,
  horizonOf,
  moveCleaning,
  pairOfReactor,
  removeCampaign,
  removeCleaning,
  resizeCampaign,
  setCampaignGrade,
  splitCampaign,
  swapCampaign,
  type Draft,
  type Pair,
} from './manualPlan';
import './optimize.css';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Bounds mirror OptimizeRequest in Backend/optimization/schemas.py so the
// page never sends a request the backend would reject with 422.
const HORIZON_MIN = 7;
const HORIZON_MAX = 120;
const TIME_LIMIT_MIN = 5;
const TIME_LIMIT_MAX = 300;

// Gantt geometry (keep in sync with .opt-ghead / .opt-grow in optimize.css).
const CELL_W = 46;
const LABEL_W = 70;

type Phase = 'loading' | 'ok' | 'offline' | 'stale';

/** Every input the planner can edit — one field per OptimizeRequest field. */
interface PlanForm {
  horizonDays: number;
  startDate: string;     // ISO date; '' lets the backend pick next Monday
  objective: string;
  holidays: string[];    // ISO dates; blank rows are dropped when sending
  initGrade: string;
  remainDays: number;
  rx12Age: number;
  rx34Age: number;
  timeLimitS: number;
  demand: Record<string, number>;
}

/** Why the latest run produced no plan. */
interface SolveProblem {
  status: 'infeasible' | 'unknown' | 'error';
  message: string;
  key: string;           // request that failed — banner hides once inputs change
}

/** The request behind the result currently on screen. */
interface ShownResult {
  key: string;
  form: PlanForm;
}

/** Edit mode: the optimized plan is the ghost, the draft is what the planner changes. */
interface ManualState {
  form: PlanForm;                  // inputs the base plan was solved for — rule checks use these
  base: OptimizeResult;            // the optimized plan (ghost row)
  baseEval: OptimizeResult | null; // evaluator's view of the unedited draft — KPI deltas compare to this
  draft: Draft;
  result: OptimizeResult | null;   // evaluation of the current draft
  checking: boolean;
  error: string | null;
  selected: number | null;         // selected campaign index
}

type Drag =
  | { kind: 'resize'; index: number; startX: number; origDays: number; nextDays: number }
  | { kind: 'clean'; index: number; startX: number; origStart: number };

interface TipState {
  x: number;
  y: number;
  lines: string[];
}

// Changeover penalty per objective (tons-equivalent per changeover day),
// see OBJ_CHANGEOVER_PENALTY in Backend/optimization/engine.py.
const OBJECTIVES = [
  { id: 'maximize_fulfilled', label: 'Maximize fulfilled demand', penalty: 2 },
  { id: 'balance', label: 'Balance', penalty: 60 },
  { id: 'minimize_changeover', label: 'Minimize changeovers', penalty: 400 },
];

const BASE_FORM: PlanForm = {
  horizonDays: 28,
  startDate: '',
  objective: 'maximize_fulfilled',
  holidays: [],
  initGrade: 'BR150',
  remainDays: 2,
  rx12Age: 54,
  rx34Age: 0,
  timeLimitS: 30,
  demand: { ...DEMAND_DEFAULT },
};

function clamp(n: number, lo: number, hi: number): number {
  const v = Number.isFinite(n) ? Math.round(n) : lo;
  return Math.min(hi, Math.max(lo, v));
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function signed(n: number, digits = 0): string {
  const v = digits ? n.toFixed(digits) : fmt(Math.round(n));
  return n > 0 ? `+${v}` : `${v}`;
}

function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Same rule as engine._next_monday: today is never the start day. */
function nextMondayIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const ahead = (1 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + ahead);
  return toIso(d);
}

function scaleDemand(base: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(base).forEach(([g, v]) => {
    out[g] = Math.round(v * factor);
  });
  return out;
}

/** The exact JSON body for POST /api/v1/optimize (stable key order). */
function buildRequest(f: PlanForm) {
  const demand: Record<string, number> = {};
  GRADES.forEach((g) => {
    const v = f.demand[g.id];
    demand[g.id] = Number.isFinite(v) && v >= 0 ? v : 0;
  });
  return {
    horizon_days: clamp(f.horizonDays, HORIZON_MIN, HORIZON_MAX),
    start_date: f.startDate,
    objective: f.objective,
    demand,
    holidays: f.holidays.filter(Boolean),
    time_limit_s: clamp(f.timeLimitS, TIME_LIMIT_MIN, TIME_LIMIT_MAX),
    initial: {
      grade: f.initGrade,
      remain_days: clamp(f.remainDays, 0, HORIZON_MAX),
      rx12_age: clamp(f.rx12Age, 0, 365),
      rx34_age: clamp(f.rx34Age, 0, 365),
    },
  };
}

interface Preset {
  id: string;
  label: string;
  hint: string;
  apply: (current: PlanForm) => PlanForm;
}

// Quick scenarios: each resets the plan inputs but keeps the calendar
// (start date + holidays) the planner already set.
const PRESETS: Preset[] = [
  {
    id: 'base',
    label: 'Base',
    hint: 'Demo demand, 28 days, RX1-2 at age 54',
    apply: (c) => ({ ...BASE_FORM, startDate: c.startDate, holidays: c.holidays, demand: { ...DEMAND_DEFAULT } }),
  },
  {
    id: 'surge',
    label: 'Demand +20%',
    hint: 'Every grade +20% — expect shortages on the low-capacity grades',
    apply: (c) => ({ ...BASE_FORM, startDate: c.startDate, holidays: c.holidays, demand: scaleDemand(DEMAND_DEFAULT, 1.2) }),
  },
  {
    id: 'vcr',
    label: 'Heavy VCR',
    hint: 'VCR-412 1,500 t and VCR-617 2,000 t — forces a long VCR campaign on all four reactors',
    apply: (c) => ({
      ...BASE_FORM,
      startDate: c.startDate,
      holidays: c.holidays,
      demand: { ...DEMAND_DEFAULT, VCR412: 1500, VCR617: 2000 },
    }),
  },
  {
    id: 'clean',
    label: 'RX1-2 near cleaning',
    hint: 'RX1-2 already at age 58 — the 7-day cleaning is due within two days',
    apply: (c) => ({ ...BASE_FORM, startDate: c.startDate, holidays: c.holidays, demand: { ...DEMAND_DEFAULT }, rx12Age: 58 }),
  },
];

const STATUS_EN: Record<string, string> = { prod: 'Producing', clean: 'Cleaning', idle: 'Standby' };

export default function OptimizePage() {
  const [form, setForm] = useState<PlanForm>(BASE_FORM);
  const [data, setData] = useState<OptimizeResult | null>(null);
  const [shown, setShown] = useState<ShownResult | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [solving, setSolving] = useState(false);
  const [problem, setProblem] = useState<SolveProblem | null>(null);
  const [manual, setManual] = useState<ManualState | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  // Guards against a slow earlier solve overwriting a newer result
  // (solves may legitimately take the full time limit).
  const runSeq = useRef(0);
  const evalSeq = useRef(0);
  const manualRef = useRef<ManualState | null>(null);
  manualRef.current = manual;
  const dragRef = useRef<Drag | null>(null);

  const currentKey = useMemo(() => JSON.stringify(buildRequest(form)), [form]);
  const unapplied = !!shown && shown.key !== currentKey;
  const showProblem = !!problem && problem.key === currentKey;

  async function run(f: PlanForm = form) {
    const body = buildRequest(f);
    const key = JSON.stringify(body);
    const seq = ++runSeq.current;
    setSolving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: key,
      });
      if (seq !== runSeq.current) return;
      if (!res.ok) {
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 300);
        } catch {
          detail = '';
        }
        setProblem({
          status: 'error',
          message: `The backend answered HTTP ${res.status}${detail ? ` — ${detail}` : ''}.`,
          key,
        });
        if (!data) {
          // First call already failed: show the bundled sample so the
          // page is usable, with the banner explaining the failure.
          setData(SAMPLE_PLAN);
          setShown({ key, form: f });
        }
        setPhase('ok');
        return;
      }
      const json: OptimizeResult = await res.json();
      if (seq !== runSeq.current) return;
      // Contract guard: a backend older than this page answers without the
      // per-reactor fields — show it as stale instead of crashing.
      if (!json.pair_notes || (json.days?.length > 0 && !json.days[0].reactors)) {
        setData(SAMPLE_PLAN);
        setShown({ key, form: f });
        setProblem(null);
        setManual(null);
        setPhase('stale');
        return;
      }
      if (json.status !== 'feasible') {
        // Keep the previous plan on screen so the planner can compare;
        // the banner explains what to change.
        const status = json.status === 'infeasible' ? 'infeasible' : 'unknown';
        setProblem({ status, message: json.message || json.kpis?.status || status, key });
        if (!data) {
          setData(json);
          setShown({ key, form: f });
        }
        setPhase('ok');
        return;
      }
      setData(json);
      setShown({ key, form: f });
      setProblem(null);
      setManual(null);
      setPhase('ok');
    } catch {
      if (seq !== runSeq.current) return;
      // Standalone fallback: identical data ships with the page, so the
      // planner can explore the mock plan without the backend running.
      setData(SAMPLE_PLAN);
      setShown({ key, form: f });
      setProblem(null);
      setManual(null);
      setPhase('offline');
    } finally {
      if (seq === runSeq.current) setSolving(false);
    }
  }

  useEffect(() => {
    // Pick the start date on the client so SSR and the browser render the
    // same empty input; the backend would default to next Monday anyway.
    const initial = { ...BASE_FORM, startDate: nextMondayIso(), demand: { ...DEMAND_DEFAULT } };
    setForm(initial);
    run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(partial: Partial<PlanForm>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function applyAndRun(next: PlanForm) {
    setForm(next);
    run(next);
  }

  function updateDemand(grade: string, raw: string) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    setForm((prev) => ({ ...prev, demand: { ...prev.demand, [grade]: num } }));
  }

  function setHoliday(index: number, value: string) {
    setForm((prev) => {
      const holidays = prev.holidays.slice();
      holidays[index] = value;
      return { ...prev, holidays };
    });
  }

  function removeHoliday(index: number) {
    setForm((prev) => ({ ...prev, holidays: prev.holidays.filter((_, i) => i !== index) }));
  }

  // ---------------------------------------------------------------- edit mode
  async function evaluateDraft(m: ManualState, draft: Draft, asBase = false) {
    const seq = ++evalSeq.current;
    setManual((prev) => (prev ? { ...prev, draft, checking: true } : prev));
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/optimize/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildRequest(m.form), ...draft }),
      });
      if (seq !== evalSeq.current) return;
      if (!res.ok) {
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
          detail = '';
        }
        setManual((prev) => (prev ? { ...prev, checking: false, error: `Rule check failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}` } : prev));
        return;
      }
      const json: OptimizeResult = await res.json();
      if (seq !== evalSeq.current) return;
      setManual((prev) =>
        prev ? { ...prev, checking: false, error: null, result: json, baseEval: asBase ? json : prev.baseEval } : prev,
      );
    } catch {
      if (seq !== evalSeq.current) return;
      setManual((prev) => (prev ? { ...prev, checking: false, error: 'Cannot reach the backend to check the plan — edits are not verified.' } : prev));
    }
  }

  function startEditing() {
    if (!data || !shown || data.days.length === 0) return;
    const draft = draftFromResult(data);
    const m: ManualState = {
      form: shown.form,
      base: data,
      baseEval: null,
      draft,
      result: null,
      checking: true,
      error: null,
      selected: null,
    };
    setManual(m);
    evaluateDraft(m, draft, true);
  }

  function stopEditing() {
    evalSeq.current += 1;
    dragRef.current = null;
    setManual(null);
  }

  /** Apply a draft change; `verify` false keeps a live drag preview unverified until pointer-up. */
  function updateDraft(next: Draft, verify = true, selected?: number | null) {
    const m = manualRef.current;
    if (!m) return;
    const sel = selected === undefined ? m.selected : selected;
    const clampedSel = sel === null ? null : Math.min(next.campaigns.length - 1, Math.max(0, sel));
    if (verify) {
      setManual((prev) => (prev ? { ...prev, selected: clampedSel } : prev));
      evaluateDraft(m, next);
    } else {
      setManual((prev) => (prev ? { ...prev, draft: next, selected: clampedSel } : prev));
    }
  }

  // Drags listen on window (not on the element) so the pointer may leave
  // the block, the grid may re-render under it, and synthetic input still
  // delivers the final pointer-up that triggers the rule check.
  function beginDrag(drag: Drag) {
    dragRef.current = drag;
    const move = (ev: PointerEvent) => dragTo(ev.clientX);
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('mouseup', end);
      finishDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('mouseup', end);
  }

  function onResizeDown(e: React.PointerEvent<HTMLElement>, index: number) {
    const m = manualRef.current;
    if (!m || index >= m.draft.campaigns.length - 1) return;
    e.preventDefault();
    e.stopPropagation();
    setManual((prev) => (prev ? { ...prev, selected: index } : prev));
    beginDrag({
      kind: 'resize',
      index,
      startX: e.clientX,
      origDays: m.draft.campaigns[index].days,
      nextDays: m.draft.campaigns[index + 1].days,
    });
  }

  function onCleanDown(e: React.PointerEvent<HTMLElement>, pair: Pair, day: number) {
    const m = manualRef.current;
    if (!m) return;
    const index = cleaningAt(m.draft, pair, day);
    if (index < 0) return;
    e.preventDefault();
    e.stopPropagation();
    beginDrag({ kind: 'clean', index, startX: e.clientX, origStart: m.draft.cleanings[index].start });
  }

  function dragTo(clientX: number) {
    const drag = dragRef.current;
    const m = manualRef.current;
    if (!drag || !m) return;
    const delta = Math.round((clientX - drag.startX) / CELL_W);
    if (drag.kind === 'resize') {
      const total = drag.origDays + drag.nextDays;
      const days = Math.min(total - 1, Math.max(1, drag.origDays + delta));
      if (days !== m.draft.campaigns[drag.index].days) {
        updateDraft(resizeCampaign(m.draft, drag.index, days), false);
      }
    } else {
      const H = horizonOf(m.draft);
      const start = Math.min(H - 1, Math.max(0, drag.origStart + delta));
      if (start !== m.draft.cleanings[drag.index]?.start) {
        updateDraft(moveCleaning(m.draft, drag.index, start, H), false);
      }
    }
  }

  function finishDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const m = manualRef.current;
    if (m) evaluateDraft(m, m.draft);
  }

  function showTip(e: React.MouseEvent, d: PlanDay, reactor?: { id: string; status: string }) {
    const lines = [`${d.date} · ${d.wd}${d.wknd ? ' · weekend' : ''}`];
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
  const grades = data?.grades ?? GRADES;
  const objective = OBJECTIVES.find((o) => o.id === form.objective) ?? OBJECTIVES[0];
  // What the stage draws: the evaluated draft while editing, else the solver result.
  const view: OptimizeResult | null = manual ? manual.result ?? manual.base : data;
  const hasPlan = !!view && view.days.length > 0;
  const editing = !!manual;
  const conflicts = manual ? conflictCount(manual.result) : 0;
  const conflictDays = useMemo(() => conflictDaysOf(manual?.result ?? null), [manual?.result]);
  const starts = manual ? campaignStarts(manual.draft) : [];
  const selectedCampaign = manual && manual.selected !== null ? manual.draft.campaigns[manual.selected] ?? null : null;
  const canEdit = !!data && data.days.length > 0 && !offline && phase !== 'stale';
  const gridCols = `${LABEL_W}px repeat(${Math.max(1, view?.days.length ?? 1)}, ${CELL_W}px)`;

  function kpiDelta(key: 'total_tons' | 'fulfillment_pct' | 'shortage_tons' | 'changeover_days', higherIsBetter: boolean, suffix = '') {
    if (!manual || !manual.baseEval || !manual.result) return null;
    const diff = manual.result.kpis[key] - manual.baseEval.kpis[key];
    if (Math.abs(diff) < 1e-9) return <div className="opt-delta same">= optimized plan</div>;
    const good = higherIsBetter ? diff > 0 : diff < 0;
    return (
      <div className={'opt-delta ' + (good ? 'good' : 'bad')}>
        {signed(diff, key === 'fulfillment_pct' ? 1 : 0)}{suffix} vs optimized
      </div>
    );
  }

  // Quick fixes offered in the problem banner — each applies and re-solves.
  const fixes: { label: string; next: PlanForm }[] = [];
  if (problem?.status === 'infeasible' || problem?.status === 'unknown') {
    if (form.horizonDays - 7 >= HORIZON_MIN) {
      fixes.push({ label: `Horizon −7 days (${form.horizonDays - 7})`, next: { ...form, horizonDays: form.horizonDays - 7 } });
    }
    if (problem.status === 'unknown' && form.timeLimitS < TIME_LIMIT_MAX) {
      const t = Math.min(TIME_LIMIT_MAX, form.timeLimitS + 30);
      fixes.push({ label: `Time limit +30 s (${t} s)`, next: { ...form, timeLimitS: t } });
    }
    if (problem.status === 'infeasible' && form.holidays.some(Boolean)) {
      fixes.push({ label: 'Clear holidays', next: { ...form, holidays: [] } });
    }
    if (problem.status === 'infeasible' && (form.remainDays !== BASE_FORM.remainDays || form.rx12Age !== BASE_FORM.rx12Age || form.rx34Age !== BASE_FORM.rx34Age)) {
      fixes.push({ label: 'Reset initial state', next: { ...form, remainDays: BASE_FORM.remainDays, rx12Age: BASE_FORM.rx12Age, rx34Age: BASE_FORM.rx34Age } });
    }
  }

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
          {editing && (
            <span className={'opt-badge ' + (conflicts ? 'conflict' : 'edit')}>
              <span className="opt-led" />
              {manual?.checking ? 'Editing · checking rules…' : conflicts ? `Editing · ${conflicts} rule conflict${conflicts === 1 ? '' : 's'}` : 'Editing · no rule conflicts'}
            </span>
          )}
          {phase === 'ok' && data && !editing && (
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
        <div className="opt-presets" role="group" aria-label="Quick scenarios">
          <span className="opt-plab">Quick scenarios</span>
          {PRESETS.map((p) => {
            const next = p.apply(form);
            const active = !!shown && JSON.stringify(buildRequest(next)) === shown.key && !unapplied;
            return (
              <button
                key={p.id}
                type="button"
                className={'opt-preset' + (active ? ' active' : '')}
                title={p.hint}
                disabled={solving}
                onClick={() => applyAndRun(next)}
              >
                {p.label}
              </button>
            );
          })}
          <span className="opt-railnote" style={{ margin: 0 }}>
            Sets the inputs on the left and re-solves immediately · keeps your start date and holidays
          </span>
        </div>
      )}

      {data && view && (
        <div className="opt-shell">
          {/* ================= input rail ================= */}
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
              <h2 className="opt-ph">Demand for the horizon (tons)</h2>
              {grades.map((g) => (
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
                    value={form.demand[g.id] ?? 0}
                    onChange={(e) => updateDemand(g.id, e.target.value)}
                    aria-label={`demand ${g.disp}`}
                  />
                </div>
              ))}
              <p className="opt-railnote">
                Tons to deliver within the horizon — the solver maximizes how much of this it can produce.
              </p>
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
                No grade switch happens on a weekend or holiday, and a VCR campaign never ends on one. Plant rules live in Backend/optimization/plant_config.yaml.
              </p>
            </div>
          </aside>

          {/* ================= main stage ================= */}
          <main className="opt-stage">
            <div className="opt-stagehead">
              <h1>{view.horizon_days}-Day Production Plan</h1>
              <span className="opt-title">
                <span className={'opt-sub' + (unapplied && !editing ? ' old' : '')}>
                  {view.start_date} · starts from {dispOf(shown?.form.initGrade ?? form.initGrade, grades)} ·{' '}
                  {editing ? 'hand-edited plan (optimized plan shown as ghost)' : offline ? 'built-in sample data' : 'live backend result'}
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

            <div className="opt-kpis">
              <div className="opt-tile">
                <div className="opt-lab">Total production</div>
                <div className="opt-val">{fmt(view.kpis.total_tons)} <small>t</small></div>
                <div className="opt-foot">{view.horizon_days} days · avg {fmt(Math.round(view.kpis.total_tons / Math.max(1, view.horizon_days)))} t/day</div>
                {kpiDelta('total_tons', true, ' t')}
              </div>
              <div className="opt-tile">
                <div className="opt-lab">Fulfillment</div>
                <div className="opt-val">{view.kpis.fulfillment_pct.toFixed(1)}<small>%</small></div>
                <div className="opt-foot">Σ min(produced, demand) / Σ demand</div>
                {kpiDelta('fulfillment_pct', true, ' pp')}
              </div>
              <div className="opt-tile">
                <div className="opt-lab">Shortage</div>
                <div className="opt-val">{fmt(view.kpis.shortage_tons)} <small>t</small></div>
                <div className="opt-foot">Σ max(demand − produced, 0) over all grades</div>
                {kpiDelta('shortage_tons', false, ' t')}
              </div>
              <div className="opt-tile">
                <div className="opt-lab">Changeover days</div>
                <div className="opt-val">{view.kpis.changeover_days} <small>days</small></div>
                <div className="opt-foot">per the 11-pair transition table</div>
                {kpiDelta('changeover_days', false, ' d')}
              </div>
              <div className="opt-tile">
                <div className="opt-lab">{editing ? 'Rule check' : 'Solver'}</div>
                {editing ? (
                  <div className={'opt-val' + (conflicts ? ' bad' : '')}>{conflicts} <small>conflict{conflicts === 1 ? '' : 's'}</small></div>
                ) : (
                  <div className="opt-val">{view.kpis.solve_s.toFixed(2)} <small>s</small></div>
                )}
                <div className="opt-foot">{view.kpis.status} · mode: {view.mode}</div>
              </div>
            </div>

            <section className="opt-panel" aria-label="Daily production Gantt">
              <div className="opt-phrow">
                <h2 className="opt-ph">Daily production schedule — one row per reactor (Plant + RX1–RX4)</h2>
                {!editing ? (
                  <button
                    type="button"
                    className="opt-editbtn"
                    onClick={startEditing}
                    disabled={!canEdit}
                    title={canEdit ? 'Drag campaigns and cleaning windows; every change is checked against the plant rules' : 'Needs a live backend result to check the rules'}
                  >
                    ✎ Edit plan
                  </button>
                ) : (
                  <div className="opt-editbar">
                    <button type="button" className="opt-fixbtn" onClick={startEditing} disabled={manual?.checking}>Reset to optimized</button>
                    <button type="button" className="opt-fixbtn dark" onClick={stopEditing}>Exit edit mode</button>
                  </div>
                )}
              </div>

              {editing && manual && (
                <div className="opt-edithelp">
                  <span>
                    <b>Edit:</b> drag the right edge of a campaign block to make it longer or shorter (the next campaign gives or takes the days) ·
                    drag a <i>Cleaning</i> block in a reactor row to move it · click a campaign for grade / swap / split / remove.
                    Every change is checked against plant_config.yaml; days that break a rule turn red.
                  </span>
                </div>
              )}

              {editing && manual && (
                <div className="opt-edittools">
                  <div className="opt-edittool">
                    <span className="opt-lab">Selected campaign</span>
                    {selectedCampaign && manual.selected !== null ? (
                      <div className="opt-toolrow">
                        <i className="opt-dot" style={{ background: `var(--s${slotOf(selectedCampaign.grade)})` }} />
                        <select
                          aria-label="Campaign grade"
                          value={selectedCampaign.grade}
                          onChange={(e) => updateDraft(setCampaignGrade(manual.draft, manual.selected!, e.target.value), true, null)}
                        >
                          {grades.map((g) => (
                            <option key={g.id} value={g.id}>{g.disp}</option>
                          ))}
                        </select>
                        <label className="opt-dayslbl">
                          days
                          <input
                            type="number"
                            min={1}
                            aria-label="Campaign days"
                            value={selectedCampaign.days}
                            disabled={manual.selected === manual.draft.campaigns.length - 1}
                            title={manual.selected === manual.draft.campaigns.length - 1 ? 'The last campaign runs to the horizon end — resize the one before it' : ''}
                            onChange={(e) => updateDraft(resizeCampaign(manual.draft, manual.selected!, Number(e.target.value) || 1), true)}
                          />
                        </label>
                        <button type="button" className="opt-fixbtn" disabled={manual.selected === 0} onClick={() => updateDraft(swapCampaign(manual.draft, manual.selected!, -1), true, manual.selected! - 1)}>◀ Swap</button>
                        <button type="button" className="opt-fixbtn" disabled={manual.selected === manual.draft.campaigns.length - 1} onClick={() => updateDraft(swapCampaign(manual.draft, manual.selected!, 1), true, manual.selected! + 1)}>Swap ▶</button>
                        <button
                          type="button"
                          className="opt-fixbtn"
                          disabled={selectedCampaign.days < 2}
                          title="Carve a new campaign out of the end of this one"
                          onClick={() => {
                            const alt = grades.find((g) => g.id !== selectedCampaign.grade)?.id ?? selectedCampaign.grade;
                            updateDraft(splitCampaign(manual.draft, manual.selected!, alt), true, manual.selected! + 1);
                          }}
                        >
                          Split
                        </button>
                        <button type="button" className="opt-fixbtn" disabled={manual.draft.campaigns.length < 2} onClick={() => updateDraft(removeCampaign(manual.draft, manual.selected!), true, null)}>Remove</button>
                      </div>
                    ) : (
                      <span className="opt-railnote" style={{ margin: 0 }}>Click a campaign block in the “Edit” row.</span>
                    )}
                  </div>
                  {PAIRS.map((pair) => (
                    <div className="opt-edittool" key={pair}>
                      <span className="opt-lab">{pair} cleaning ({CLEAN_DAYS} days)</span>
                      <div className="opt-toolrow">
                        {manual.draft.cleanings.map((c, i) =>
                          c.pair === pair ? (
                            <span className="opt-cleanchip" key={i}>
                              {view.days[c.start]?.date ?? `day ${c.start + 1}`}
                              {' → '}
                              {view.days[Math.min(view.days.length - 1, c.start + CLEAN_DAYS - 1)]?.date ?? ''}
                              <button type="button" aria-label={`Remove ${pair} cleaning`} title="Remove" onClick={() => updateDraft(removeCleaning(manual.draft, i), true)}>×</button>
                            </span>
                          ) : null,
                        )}
                        <button
                          type="button"
                          className="opt-fixbtn"
                          onClick={() => updateDraft(addCleaning(manual.draft, pair, manual.selected !== null ? starts[manual.selected] : 0), true)}
                        >
                          + Add cleaning
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="opt-legend">
                {grades.map((g) => (
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
                {editing && (
                  <span>
                    <i className="opt-dot" style={{ border: '2px solid var(--bad)', background: 'transparent' }} />
                    Rule conflict
                  </span>
                )}
              </div>
              {!hasPlan && (
                <p className="opt-railnote" style={{ margin: '0 0 8px' }}>
                  No plan to draw — change the inputs (or use a quick fix above) and run again.
                </p>
              )}
              <div className="opt-ganttwrap">
                <div className="opt-gantt" style={{ minWidth: LABEL_W + view.days.length * CELL_W }}>
                  <div className="opt-ghead" style={{ gridTemplateColumns: gridCols }}>
                    <div className="opt-glabel" />
                    {view.days.map((d, i) => {
                      const parts = d.date.split(' ');
                      return (
                        <div key={d.iso} className={'opt-d' + (d.wknd ? ' wknd' : '') + (conflictDays.has(i) ? ' conf' : '')}>
                          <b>{parts[0]}</b>
                          {parts.slice(1).join(' ')} · {d.wd}
                        </div>
                      );
                    })}
                  </div>

                  {editing && manual && (
                    <>
                      {/* ghost: the optimized plan this draft started from */}
                      <div className="opt-grow opt-ghostrow" style={{ gridTemplateColumns: gridCols }}>
                        <div className="opt-glabel">Optimized</div>
                        {manual.base.days.map((d) => (
                          <div
                            key={'ghost-' + d.iso}
                            className={'opt-gcell ghost' + (d.wknd ? ' wknd' : '')}
                            onMouseMove={(e) => showTip(e, d)}
                            onMouseLeave={() => setTip(null)}
                          >
                            {dayBlocks(d)}
                          </div>
                        ))}
                      </div>
                      {/* editable campaign blocks */}
                      <div className="opt-grow opt-editrow" style={{ gridTemplateColumns: gridCols }}>
                        <div className="opt-glabel" style={{ gridColumn: 1, gridRow: 1 }}>Edit</div>
                        {manual.draft.campaigns.map((c, i) => {
                          const last = i === manual.draft.campaigns.length - 1;
                          const selected = manual.selected === i;
                          return (
                            <div
                              key={i}
                              role="button"
                              tabIndex={0}
                              aria-label={`${dispOf(c.grade, grades)} campaign, ${c.days} days`}
                              aria-pressed={selected}
                              className={'opt-camp' + (selected ? ' sel' : '')}
                              style={{
                                gridColumn: `${starts[i] + 2} / span ${c.days}`,
                                gridRow: 1,
                                background: `var(--s${slotOf(c.grade)})`,
                                color: `var(--s${slotOf(c.grade)}i)`,
                              }}
                              onClick={() => setManual((prev) => (prev ? { ...prev, selected: i } : prev))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setManual((prev) => (prev ? { ...prev, selected: i } : prev));
                                } else if (!last && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                                  e.preventDefault();
                                  updateDraft(resizeCampaign(manual.draft, i, c.days + (e.key === 'ArrowRight' ? 1 : -1)), true, i);
                                }
                              }}
                            >
                              <span className="opt-camplbl">
                                {dispOf(c.grade, grades)}
                                <small>{c.days} d</small>
                              </span>
                              {!last && (
                                <span
                                  className="opt-camp-h"
                                  title="Drag to resize"
                                  onPointerDown={(e) => onResizeDown(e, i)}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="opt-grow" style={{ gridTemplateColumns: gridCols }}>
                    <div className="opt-glabel">Plant</div>
                    {view.days.map((d, i) => (
                      <div
                        key={'plant-' + d.iso}
                        className={'opt-gcell' + (d.wknd ? ' wknd' : '') + (conflictDays.has(i) ? ' conf' : '')}
                        onMouseMove={(e) => showTip(e, d)}
                        onMouseLeave={() => setTip(null)}
                      >
                        {dayBlocks(d)}
                      </div>
                    ))}
                    {['RX1', 'RX2', 'RX3', 'RX4'].map((rid) => (
                      <Fragment key={rid}>
                        <div className="opt-glabel">{rid}</div>
                        {view.days.map((d, i) => {
                          const reactor = d.reactors?.find((r) => r.id === rid);
                          const pair = pairOfReactor(rid);
                          let status = reactor?.status ?? 'prod';
                          let draggable = false;
                          if (manual) {
                            // live preview of cleaning windows while dragging
                            if (cleaningAt(manual.draft, pair, i) >= 0) {
                              status = 'clean';
                              draggable = true;
                            } else if (status === 'clean') {
                              status = 'idle';
                            }
                          }
                          return (
                            <div
                              key={d.iso}
                              className={'opt-gcell' + (d.wknd ? ' wknd' : '') + (conflictDays.has(i) ? ' conf' : '') + (draggable ? ' grab' : '')}
                              onMouseMove={(e) => showTip(e, d, { id: rid, status })}
                              onMouseLeave={() => setTip(null)}
                              onPointerDown={draggable ? (e) => onCleanDown(e, pair, i) : undefined}
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
                            {rid === 'RX2' ? view.pair_notes?.['RX1-2'] : view.pair_notes?.['RX3-4']}
                          </div>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </div>
              <p className="opt-gcap">
                Plant row = plant-level grade for the day · RX1–RX4 rows = per-reactor status (producing / cleaning / standby) · two-tone block = changeover day (uses the special ceiling of that pair) · grey columns = Sat–Sun (production allowed, but no grade change)
                {editing && ' · red outline = a plant rule is broken on that day (hover for the reason)'}
              </p>
            </section>

            <section className="opt-panel" aria-label="Demand fulfillment">
              <h2 className="opt-ph">Fulfillment by grade (produced vs demand in the horizon)</h2>
              {view.fulfillment.map((r) => {
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
              <h2 className="opt-ph">Constraint check{editing ? ' — hand-edited plan' : ''}</h2>
              <ul className="opt-checks">
                {view.checks.map((c, i) => (
                  <li key={i} className={c.level === 'conflict' ? 'conflict' : ''}>
                    <span className={`opt-mk ${c.level}`}>{c.level === 'ok' ? '✓' : c.level === 'conflict' ? '✕' : '⚠'}</span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="opt-panel opt-details" aria-label="Day-by-day table">
              <details className="opt-details">
                <summary>Full day-by-day plan ({view.days.length} rows)</summary>
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
                      {view.days.map((d, i) => (
                        <tr key={d.iso} className={conflictDays.has(i) ? 'conflict' : ''}>
                          <td className={'mono' + (d.wknd ? ' wknd' : '')}>{d.date} · {d.wd}</td>
                          <td className="mono">
                            {d.parts
                              .map((p, k) => {
                                let seg = `${dispOf(p.grade, grades)} ${fmt(p.tons)}`;
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
                {view.assumptions.map((a, i) => (
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
