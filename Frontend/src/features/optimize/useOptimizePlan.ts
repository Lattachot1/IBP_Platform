// State, solver / evaluator calls and the hand-edit (drag) logic of the
// /optimize page. Plant rules stay in the backend (plant_config.yaml).

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber } from '@/lib/format';
import { API_BASE_URL } from '@/lib/apiClient';
import { DEMAND_DEFAULT, GRADES, SAMPLE_PLAN, dispOf } from './samplePlan';
import { campaignStarts, cleaningAt, conflictCount, conflictDaysOf, draftFromResult, horizonOf, moveCleaning, resizeCampaign, type Draft, type Pair } from './manualPlan';
import { HORIZON_MIN, TIME_LIMIT_MAX, OBJECTIVES, BASE_FORM, nextMondayIso, buildRequest, type PlanForm } from './planForm';
import type { OptimizeResult, PlanDay } from './types';

// Gantt geometry (keep in sync with .opt-ghead / .opt-grow in optimize.css).
export const CELL_W = 46;
export const LABEL_W = 70;

export type Phase = 'loading' | 'ok' | 'offline' | 'stale';

/** Why the latest run produced no plan. */
export interface SolveProblem {
  status: 'infeasible' | 'unknown' | 'error';
  message: string;
  key: string;           // request that failed — banner hides once inputs change
}

/** The request behind the result currently on screen. */
export interface ShownResult {
  key: string;
  form: PlanForm;
}

/** Edit mode: the optimized plan is the ghost, the draft is what the planner changes. */
export interface ManualState {
  form: PlanForm;                  // inputs the base plan was solved for — rule checks use these
  base: OptimizeResult;            // the optimized plan (ghost row)
  baseEval: OptimizeResult | null; // evaluator's view of the unedited draft — KPI deltas compare to this
  draft: Draft;
  result: OptimizeResult | null;   // evaluation of the current draft
  checking: boolean;
  error: string | null;
  selected: number | null;         // selected campaign index
}

export type Drag =
  | { kind: 'resize'; index: number; startX: number; origDays: number; nextDays: number }
  | { kind: 'clean'; index: number; startX: number; origStart: number };

export interface TipState {
  x: number;
  y: number;
  lines: string[];
}

export const STATUS_EN: Record<string, string> = { prod: 'Producing', clean: 'Cleaning', idle: 'Standby' };

export function useOptimizePlan() {
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
      let line = `${dispOf(p.grade, data?.grades)}: ${formatNumber(p.tons)} t`;
      if (d.chg) line += ` (total ≤ ${formatNumber(d.cap ?? 0)})`;
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

  return {
    form,
    data,
    shown,
    phase,
    solving,
    problem,
    manual,
    setManual,
    tip,
    setTip,
    unapplied,
    showProblem,
    run,
    patch,
    applyAndRun,
    updateDemand,
    setHoliday,
    removeHoliday,
    startEditing,
    stopEditing,
    updateDraft,
    onResizeDown,
    onCleanDown,
    showTip,
    offline,
    grades,
    objective,
    view,
    hasPlan,
    editing,
    conflicts,
    conflictDays,
    starts,
    selectedCampaign,
    canEdit,
    gridCols,
    fixes,
  };
}

export type OptimizePlan = ReturnType<typeof useOptimizePlan>;
