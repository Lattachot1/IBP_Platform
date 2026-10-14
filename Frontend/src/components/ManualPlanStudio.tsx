"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  DragMoveEvent,
  DragEndEvent,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Factory,
  GripVertical,
  Minimize2,
  Minus,
  Package,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Settings2,
  ShoppingCart,
  Trash2,
  Undo2,
  Waves,
  X,
  Eye,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OptimizationDemoResponse } from "../lib/optimizationApi";
import { useScenario } from './ScenarioContext';
import { validScenario } from '../lib/connectedScenario';
import {
  Campaign,
  Cleaning,
  DEFAULT_ASSUMPTIONS,
  Delivery,
  GRADE_RULES,
  Grade,
  ManualPlan,
  Pair,
  PlanAssumptions,
  Purchase,
  dateAt,
  dayAt,
  evaluatePlan,
  isWeekend,
  makeDraft,
} from "../lib/manualPlanning";

type ItemKind = "campaign" | "purchase" | "cleaning" | "delivery";
type Selection = { kind: ItemKind; id: string };
const KEYS = {
  campaign: "campaigns",
  purchase: "purchases",
  cleaning: "cleanings",
  delivery: "deliveries",
} as const;
const COLORS: Record<Grade, string> = {
  BR150: "#16856b",
  BR150L: "#5398af",
  BR150B: "#d48b54",
  BR360B: "#a49351",
  VCR412: "#8b7daf",
  VCR617: "#586f92",
};
const STORAGE = "ube.connected-scenario.v2";
const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d });
const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const clone = <T,>(value: T): T => structuredClone(value);
const fingerprint = (source: OptimizationDemoResponse | null) =>
  source
    ? JSON.stringify([
        source.input,
        source.selected_plan.product_plan,
        source.horizon,
      ])
    : "standalone-demo";
function initialAssumptions(source: OptimizationDemoResponse | null) {
  const config = clone(DEFAULT_ASSUMPTIONS);
  source?.horizon.forEach((m, i) => {
    config.monthlyPrices[m] =
      source.scenario_definitions.find((s) => s.scenario === "base")
        ?.raw_prices[i] || 1500;
  });
  return config;
}
function shift(
  plan: ManualPlan,
  selection: Selection,
  start: number,
): ManualPlan {
  const next = clone(plan);
  const item = next[KEYS[selection.kind]].find((i) => i.id === selection.id);
  if (!item) return plan;
  const duration = "duration" in item ? item.duration : 1;
  item.start = Math.max(0, Math.min(plan.days - duration, Math.round(start)));
  return next;
}

function TimelineItem({
  kind,
  item,
  width,
  selected,
  onSelect,
  onResize,
}: {
  kind: ItemKind;
  item: Campaign | Purchase | Cleaning | Delivery;
  width: number;
  selected: boolean;
  onSelect: () => void;
  onResize?: (duration: number, commit: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${kind}:${item.id}`,
  });
  const resizing = useRef<{ x: number; duration: number } | null>(null);
  const duration = "duration" in item ? item.duration : 1;
  const color =
    "grade" in item
      ? COLORS[item.grade]
      : kind === "purchase"
        ? "#41959e"
        : "#7c8790";
  const label =
    kind === "campaign"
      ? `${(item as Campaign).grade} production`
      : kind === "purchase"
        ? `Butadiene arrival ${fmt((item as Purchase).tons)} tonnes`
        : kind === "cleaning"
          ? `${(item as Cleaning).pair} cleaning`
          : `${(item as Delivery).grade} delivery ${fmt((item as Delivery).tons)} tonnes`;
  const point = kind === "purchase" || kind === "delivery";
  const markerSize = Math.min(20, width - 2);
  return (
    <div
      className={`gantt-item ${kind} ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      style={
        {
          left: item.start * width + (point ? (width - markerSize) / 2 : 2),
          width: point ? markerSize : duration * width - 4,
          height: point ? markerSize : undefined,
          "--event-color": color,
        } as React.CSSProperties
      }
      data-kind={kind}
      data-id={item.id}
      data-start={item.start}
      data-duration={duration}
    >
      <button
        ref={setNodeRef}
        className="gantt-item-body"
        {...attributes}
        {...listeners}
        aria-label={label}
        title={`${label} / day ${item.start + 1}${point ? "" : ` / ${duration} days`}`}
        onClick={onSelect}
      >
        {kind === "campaign" ? (
          <>
            <GripVertical size={12} />
            <span>
              <strong>{(item as Campaign).grade}</strong>
              <small>{duration}d</small>
            </span>
          </>
        ) : kind === "cleaning" ? (
          <>
            <Waves size={13} />
            <span>Clean / {duration}d</span>
          </>
        ) : kind === "purchase" ? (
          <ShoppingCart size={Math.min(12, markerSize - 3)} />
        ) : (
          <Package size={Math.min(11, markerSize - 3)} />
        )}
      </button>
      {kind === "campaign" && onResize && (
        <button
          className="gantt-resize"
          aria-label={`Resize ${(item as Campaign).grade} campaign`}
          title="Resize production run"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            resizing.current = { x: e.clientX, duration };
            onSelect();
          }}
          onPointerMove={(e) => {
            if (resizing.current)
              onResize(
                Math.max(
                  1,
                  resizing.current.duration +
                    Math.round((e.clientX - resizing.current.x) / width),
                ),
                false,
              );
          }}
          onPointerUp={(e) => {
            if (!resizing.current) return;
            onResize(
              Math.max(
                1,
                resizing.current.duration +
                  Math.round((e.clientX - resizing.current.x) / width),
              ),
              true,
            );
            resizing.current = null;
          }}
          onPointerCancel={() => {
            if (resizing.current) onResize(resizing.current.duration, true);
            resizing.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              onResize(
                Math.max(1, duration + (e.key === "ArrowRight" ? 1 : -1)),
                true,
              );
            }
          }}
        >
          <span />
          <span />
        </button>
      )}
    </div>
  );
}

export function ManualPlanStudio({
  source,
  active,
}: {
  source: OptimizationDemoResponse | null;
  active: boolean;
}) {
  const scenario = useScenario();
  const baseline = scenario.seed.plan;
  const draft = scenario.plan;
  const setDraft = scenario.setPlan;
  const assumptions = scenario.assumptions;
  const setAssumptions = scenario.setAssumptions;
  const [sourceKey, setSourceKey] = useState(() => fingerprint(source));
  const preview = scenario.previewPlan;
  const setPreview = scenario.setPreviewPlan;
  const [ghost, setGhost] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<"edit" | "checks" | "assumptions">("edit");
  const [cellWidth, setCellWidth] = useState(34);
  const selectedDay = scenario.day;
  const setSelectedDay = scenario.setDay;
  const [addKind, setAddKind] = useState<ItemKind>("campaign");
  const [note, setNote] = useState("");
  const [confirmReset, setConfirmReset] = useState<"reset" | "source" | null>(
    null,
  );
  const [savedExists, setSavedExists] = useState(false);
  const dragBase = useRef<ManualPlan | null>(null);
  const viewPlan = preview || draft;
  const scroll = useRef<HTMLDivElement>(null);
  const current = scenario.current.evaluation;
  const previous = scenario.baseline.evaluation;
  const selectedItem = selection
    ? viewPlan[KEYS[selection.kind]].find((i) => i.id === selection.id)
    : null;
  const changed = JSON.stringify(scenario.state) !== JSON.stringify(scenario.seed);
  const commitmentsChanged =
    JSON.stringify(viewPlan.deliveries) !== JSON.stringify(baseline.deliveries);
  const conflicts = current.issues.filter((i) => i.severity === "conflict");
  const warningGroups = current.issues.reduce((map, issue) => {
    const key = `${issue.code}:${issue.text}`;
    const known = map.get(key);
    if (known) known.days.push(issue.day);
    else map.set(key, { ...issue, days: [issue.day] });
    return map;
  }, new Map<string, (typeof current.issues)[number] & { days: number[] }>());
  const days = Array.from({ length: draft.days }, (_, day) => ({
    day,
    date: dateAt(draft.startDate, day),
  }));
  const chart = current.daily.map((d, i) => ({
    ...d,
    baselineFG: previous.daily[i]?.fg || 0,
  }));
  const coordinateGetter: KeyboardCoordinateGetter = (
    event,
    { currentCoordinates },
  ) =>
    event.code === "ArrowRight"
      ? { ...currentCoordinates, x: currentCoordinates.x + cellWidth }
      : event.code === "ArrowLeft"
        ? { ...currentCoordinates, x: currentCoordinates.x - cellWidth }
        : undefined;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  );
  const latest = useRef(draft);
  latest.current = draft;
  const receivedSource = useRef(false);
  const userEdited = useRef(false);
  const confirmation = useRef<HTMLDivElement>(null);
  const conflictDays = new Set(conflicts.map((issue) => issue.day));

  useEffect(() => {
    if (!confirmReset) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const buttons = () =>
      Array.from(
        confirmation.current?.querySelectorAll<HTMLButtonElement>("button") ||
          [],
      );
    buttons()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmReset(null);
      const all = buttons();
      if (
        event.key === "Tab" &&
        event.shiftKey &&
        document.activeElement === all[0]
      ) {
        event.preventDefault();
        all[all.length - 1]?.focus();
      }
      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        document.activeElement === all[all.length - 1]
      ) {
        event.preventDefault();
        all[0]?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [confirmReset]);

  useEffect(() => {
    try {
      setSavedExists(!!localStorage.getItem(STORAGE));
    } catch {
      /* Local storage is optional. */
    }
  }, []);
  useEffect(() => {
    if (!active) {
      setPreview(null);
      dragBase.current = null;
    }
  }, [active]);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(""), 5000);
    return () => clearTimeout(timer);
  }, [note]);

  function commit(next: ManualPlan) {
    userEdited.current = true;
    if (JSON.stringify(next) === JSON.stringify(latest.current)) {
      setPreview(null);
      return;
    }
    setDraft(next);
    setPreview(null);
  }
  function patchItem(
    values: Partial<Campaign & Purchase & Cleaning & Delivery>,
  ) {
    if (!selection) return;
    const next = clone(draft);
    const item = next[KEYS[selection.kind]].find((i) => i.id === selection.id);
    if (item) Object.assign(item, values);
    commit(next);
  }
  function resize(id: string, duration: number, done: boolean) {
    const next = clone(draft);
    const item = next.campaigns.find((i) => i.id === id);
    if (!item) return;
    item.duration = Math.min(draft.days - item.start, duration);
    if (done) commit(next);
    else setPreview(next);
  }
  function dragMove(event: DragMoveEvent | DragEndEvent, done: boolean) {
    const [kind, id] = String(event.active.id).split(":") as [ItemKind, string];
    const base = dragBase.current || draft;
    const item = base[KEYS[kind]].find((i) => i.id === id);
    if (!item) return;
    const next = shift(
      base,
      { kind, id },
      item.start + Math.round(event.delta.x / cellWidth),
    );
    if (done) {
      commit(next);
      dragBase.current = null;
    } else setPreview(next);
  }
  function jump(day: number) {
    setSelectedDay(day);
    if (scroll.current)
      scroll.current.scrollLeft = Math.max(
        0,
        day * cellWidth - scroll.current.clientWidth / 2 + 160,
      );
  }
  function addItem() {
    const id = crypto.randomUUID();
    const next = clone(draft);
    if (addKind === "campaign")
      next.campaigns.push({
        id,
        grade: "BR150",
        start: selectedDay,
        duration: Math.min(2, draft.days - selectedDay),
      });
    if (addKind === "purchase")
      next.purchases.push({ id, start: selectedDay, tons: 1000, price: null });
    if (addKind === "cleaning")
      next.cleanings.push({
        id,
        pair: "RX1+RX2",
        start: Math.min(selectedDay, draft.days - 7),
        duration: 7,
      });
    if (addKind === "delivery")
      next.deliveries.push({
        id,
        grade: "BR150",
        start: selectedDay,
        tons: 250,
      });
    commit(next);
    setSelection({ kind: addKind, id });
    setTab("edit");
  }
  function remove() {
    if (!selection) return;
    const next = clone(draft);
    const items = next[KEYS[selection.kind]] as { id: string }[];
    const index = items.findIndex((i) => i.id === selection.id);
    if (index >= 0) items.splice(index, 1);
    commit(next);
    setSelection(null);
  }
  function swapCampaign(direction: -1 | 1) {
    if (selection?.kind !== "campaign") return;
    const ordered = [...draft.campaigns].sort((a, b) => a.start - b.start);
    const index = ordered.findIndex((c) => c.id === selection.id);
    const neighbor = ordered[index + direction];
    if (!neighbor) return;
    const left = direction === -1 ? neighbor : ordered[index];
    const right = direction === -1 ? ordered[index] : neighbor;
    const gap = right.start - left.start - left.duration;
    if (gap < 0) {
      setNote("Resolve overlapping campaigns before swapping their order.");
      return;
    }
    const next = clone(draft);
    next.campaigns.find((c) => c.id === right.id)!.start = left.start;
    next.campaigns.find((c) => c.id === left.id)!.start =
      left.start + right.duration + gap;
    commit(next);
  }
  function save() {
    if (preview) return;
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify(scenario.state),
      );
      setSavedExists(true);
      setNote("Connected scenario saved in this browser.");
    } catch {
      setNote("Browser storage unavailable. Export this draft instead.");
    }
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (!validScenario(saved))
        throw new Error("Invalid draft");
      // Evaluate before adopting a damaged or obsolete local snapshot.
      evaluatePlan(saved.plan, saved.assumptions);
      receivedSource.current = true;
      userEdited.current = true;
      scenario.commit(saved, 'Saved connected scenario restored');
      setSelection(null);
      setPreview(null);
      setNote("Saved connected scenario restored across all views.");
    } catch {
      setNote("Saved draft could not be restored. Current work is unchanged.");
    }
  }
  function reset(mode: "reset" | "source") {
    scenario.reset();
    setPreview(null);
    setSelection(null);
    setConfirmReset(null);
    setSelectedDay(0);
  }
  function exportPlan() {
    if (preview) return;
    const contents = {
      version: 1,
      connected_snapshot: scenario.state,
      status: "unverified_manual_simulation_not_factory_plan",
      notes: [
        "No OT",
        "Default 3-calendar-day lag is provisional; current lag is in assumptions",
        "Weekly simulated deliveries; not confirmed orders",
        "BOM, stocks, prices and cost rates are demo assumptions",
        "Transition output allocated to incoming grade; split unverified",
        "Initial reactor ages and complete factory cycle logic not verified",
        "Shortage is lost sales; no backlog",
        "Material-starved or overlapping production is not credited",
        "Not a solver re-optimization",
      ],
      draft,
      baseline,
      assumptions,
      evaluation: current,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(contents, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "ube-manual-plan.json";
    a.click();
    URL.revokeObjectURL(url);
    setNote("Draft, assumptions and daily impacts exported.");
  }
  function config(key: keyof PlanAssumptions, value: number) {
    setAssumptions((current) => ({ ...current, [key]: value }));
  }
  const selectedBalance = current.daily[selectedDay];
  const metric = (
    label: string,
    value: number,
    before: number,
    suffix: string,
    smaller: boolean,
  ) => (
    <div className="manual-metric">
      <span>{label}</span>
      <strong>
        {fmt(value, suffix === "%" ? 1 : 0)}
        <small>{suffix}</small>
      </strong>
      <div
        className={
          (value - before) * (smaller ? -1 : 1) >= 0 ? "better" : "worse"
        }
      >
        {value === before
          ? "No change"
          : `${value > before ? "+" : ""}${fmt(value - before, 1)}${suffix} vs baseline`}
        <small>
          Baseline {fmt(before, 1)}
          {suffix}
        </small>
      </div>
    </div>
  );
  const choose = (kind: ItemKind, id: string) => {
    setSelection({ kind, id });
    setTab("edit");
  };
  const itemElement = (
    kind: ItemKind,
    item: Campaign | Purchase | Cleaning | Delivery,
  ) => (
    <TimelineItem
      key={item.id}
      kind={kind}
      item={item}
      width={cellWidth}
      selected={selection?.id === item.id}
      onSelect={() => choose(kind, item.id)}
      onResize={
        kind === "campaign"
          ? (duration, done) => resize(item.id, duration, done)
          : undefined
      }
    />
  );
  const fields = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    min = 0,
    max = 100000000,
    step = 1,
  ) => (
    <label key={label} className="manual-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          userEdited.current = true;
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </label>
  );

  if (!active) return null;
  return (
    <div className="manual-studio">
      {commitmentsChanged && (
        <div className="manual-source-note">
          Delivery commitments changed. Service is now evaluated against edited
          due dates and quantities, not the original demand profile.
        </div>
      )}
      <div className="manual-intro">
        <span>
          <Factory size={17} />
          MANUAL PLANNING LAB
        </span>
        <strong>
          {preview
            ? "Live drag preview"
            : changed
              ? "Modified draft"
              : "Initial daily draft"}
        </strong>
        <span className="manual-demo">
          Simulated orders / no OT / {assumptions.lag}-day lag provisional
        </span>
      </div>
      <div className="manual-metrics">
        {metric(
          "On-time fulfilled demand",
          current.service,
          previous.service,
          "%",
          false,
        )}
        {metric(
          "Unmet demand / lost sales",
          current.totalShortage,
          previous.totalShortage,
          " t",
          true,
        )}
        {metric(
          "Ending FG stock",
          current.endingFG,
          previous.endingFG,
          " t",
          true,
        )}
        {metric(
          "Modeled cost / penalty excluded",
          scenario.current.costExcludingPenalty,
          scenario.baseline.costExcludingPenalty,
          " USD",
          true,
        )}
        <div className="manual-metric">
          <span>Validation conflicts</span>
          <strong className={conflicts.length ? "worse" : "better"}>
            {conflicts.length}
            <small>day-level findings</small>
          </strong>
          <div>
            Not an approved feasible plan
            <small>
              {current.issues.filter((i) => i.severity === "warning").length}{" "}
              advisory findings / incomplete rule coverage
            </small>
          </div>
        </div>
      </div>
      {fingerprint(source) !== sourceKey && (
        <div className="manual-source-note">
          A newer monthly optimizer result is available. Your manual draft is
          unchanged.
          <button onClick={() => setConfirmReset("source")}>
            Load new monthly quantities
            <ArrowRight size={13} />
          </button>
        </div>
      )}
      <div className="manual-toolbar">
        <div className="manual-toolbar-group">
          <button
            className="icon-button"
            title="Undo plan edit"
            aria-label="Undo plan edit"
            disabled={!scenario.canUndo || !!preview}
            onClick={scenario.undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            title="Redo plan edit"
            aria-label="Redo plan edit"
            disabled={!scenario.canRedo || !!preview}
            onClick={scenario.redo}
          >
            <Redo2 size={17} />
          </button>
          <button
            className="icon-button"
            title="Reset to initial draft"
            aria-label="Reset to initial draft"
            onClick={() => setConfirmReset("reset")}
          >
            <RotateCcw size={17} />
          </button>
          <span className="toolbar-divider" />
          <button className="icon-button" aria-label="Toggle ghost plan" title="Original plan overlay" aria-pressed={ghost} onClick={() => setGhost(value => !value)}><Eye size={17} /></button>
          <select
            aria-label="New planning event"
            value={addKind}
            onChange={(e) => setAddKind(e.target.value as ItemKind)}
          >
            <option value="campaign">Production campaign</option>
            <option value="purchase">Butadiene arrival</option>
            <option value="cleaning">Reactor cleaning</option>
            <option value="delivery">Delivery commitment</option>
          </select>
          <button className="button" onClick={addItem}>
            <Plus size={15} />
            Add
          </button>
        </div>
        <div className="manual-toolbar-group">
          <button
            className="icon-button"
            title="Zoom out timeline"
            aria-label="Zoom out timeline"
            onClick={() => setCellWidth((w) => Math.max(10, w - 10))}
            disabled={cellWidth <= 10}
          >
            <Minus size={16} />
          </button>
          <button
            className="icon-button"
            title="Fit whole planning horizon"
            aria-label="Fit whole planning horizon"
            onClick={() => {
              if (scroll.current)
                setCellWidth(
                  Math.max(
                    10,
                    Math.min(
                      74,
                      Math.floor(
                        (scroll.current.clientWidth - 150) / draft.days,
                      ),
                    ),
                  ),
                );
            }}
          >
            <Minimize2 size={17} />
          </button>
          <span className="timeline-zoom">{cellWidth}px / day</span>
          <button
            className="icon-button"
            title="Zoom in timeline"
            aria-label="Zoom in timeline"
            onClick={() => setCellWidth((w) => Math.min(74, w + 10))}
            disabled={cellWidth >= 74}
          >
            <Plus size={16} />
          </button>
          <button className="button" onClick={save} disabled={!!preview}>
            <Save size={15} />
            Save draft
          </button>
          {savedExists && (
            <button
              className="icon-button"
              title="Restore saved manual draft"
              aria-label="Restore saved manual draft"
              onClick={restore}
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            className="icon-button"
            title="Export manual plan"
            aria-label="Export manual plan"
            disabled={!!preview}
            onClick={exportPlan}
          >
            <Download size={17} />
          </button>
        </div>
      </div>
      <div className="manual-main-grid">
        <section className="gantt-surface">
          <div className="gantt-title">
            <div>
              <h2>Production & procurement timeline</h2>
              <span>
                {shortDate(draft.startDate)} -{" "}
                {shortDate(dateAt(draft.startDate, draft.days - 1))} / shared
                production line
              </span>
            </div>
            <label className="timeline-jump">
              Selected day
              <input
                type="date"
                aria-label="Selected timeline day"
                min={draft.startDate}
                max={dateAt(draft.startDate, draft.days - 1)}
                value={dateAt(draft.startDate, selectedDay)}
                onChange={(e) => {
                  if (e.target.value)
                    jump(
                      Math.max(
                        0,
                        Math.min(
                          draft.days - 1,
                          dayAt(draft.startDate, e.target.value),
                        ),
                      ),
                    );
                }}
              />
            </label>
          </div>
          <DndContext
            sensors={sensors}
            autoScroll={false}
            onDragStart={(event) => {
              dragBase.current = clone(draft);
              const [kind, id] = String(event.active.id).split(":") as [
                ItemKind,
                string,
              ];
              choose(kind, id);
            }}
            onDragMove={(e) => dragMove(e, false)}
            onDragEnd={(e) => dragMove(e, true)}
            onDragCancel={() => {
              dragBase.current = null;
              setPreview(null);
            }}
          >
            <div className="gantt-scroll" ref={scroll}>
              <div
                className="gantt-grid"
                style={
                  {
                    width: 150 + draft.days * cellWidth,
                    "--day-width": `${cellWidth}px`,
                  } as React.CSSProperties
                }
              >
                <div className="gantt-header">
                  <div className="gantt-label">GRADE / RESOURCE</div>
                  <div
                    className="gantt-dates"
                    style={{ width: draft.days * cellWidth }}
                  >
                    {days.map((d) => (
                      <button
                        key={d.day}
                        className={`${isWeekend(d.date) ? "weekend" : ""} ${d.day === selectedDay ? "selected-day" : ""} ${conflictDays.has(d.day) ? "has-conflict" : ""}`}
                        style={{ width: cellWidth }}
                        onClick={() => setSelectedDay(d.day)}
                        title={d.date}
                      >
                        <small>
                          {new Date(`${d.date}T00:00:00Z`).toLocaleDateString(
                            "en-US",
                            { weekday: "narrow", timeZone: "UTC" },
                          )}
                        </small>
                        <strong>{Number(d.date.slice(-2))}</strong>
                        {d.date.endsWith("-01") && (
                          <span>
                            {new Date(`${d.date}T00:00:00Z`).toLocaleDateString(
                              "en-US",
                              { month: "short", timeZone: "UTC" },
                            )}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                {GRADE_RULES.map((g) => (
                  <div className="gantt-row" key={g.id}>
                    <div className="gantt-label">
                      <i style={{ background: COLORS[g.id] }} />
                      <strong>{g.id}</strong>
                      <small>
                        {g.capacity} t/day · min {g.minRun}d
                      </small>
                    </div>
                    <div className="gantt-lane">
                      {days.map((d) => (
                        <div
                          className={`gantt-cell ${isWeekend(d.date) ? "weekend" : ""} ${d.day === selectedDay ? "selected-day" : ""}`}
                          style={{ left: d.day * cellWidth, width: cellWidth }}
                          key={d.day}
                        />
                      ))}
                      {viewPlan.campaigns
                        .filter((c) => c.grade === g.id)
                        .map((c) => itemElement("campaign", c))}
                      {ghost && baseline.campaigns.filter(c => c.grade === g.id).map(c => (
                        <div key={`ghost-${c.id}`} className="gantt-ghost" data-ghost-id={c.id} style={{ left: c.start * cellWidth + 2, width: c.duration * cellWidth - 4, borderColor: COLORS[c.grade] }} title={`Original ${c.grade}: day ${c.start + 1}, ${c.duration} days`}><span>{c.grade} / original</span></div>
                      ))}
                      {viewPlan.deliveries
                        .filter((d) => d.grade === g.id)
                        .map((d) => itemElement("delivery", d))}
                    </div>
                  </div>
                ))}
                <div className="gantt-row resource">
                  <div className="gantt-label">
                    <ShoppingCart size={15} />
                    <strong>Butadiene</strong>
                    <small>Arrival date / tonnes</small>
                  </div>
                  <div className="gantt-lane">
                    {days.map((d) => (
                      <div
                        className={`gantt-cell ${isWeekend(d.date) ? "weekend" : ""}`}
                        style={{ left: d.day * cellWidth, width: cellWidth }}
                        key={d.day}
                      />
                    ))}
                    {viewPlan.purchases.map((p) => itemElement("purchase", p))}
                    {ghost && baseline.purchases.map(p => <div key={`ghost-${p.id}`} className="gantt-ghost receipt" style={{ left: p.start * cellWidth + 2, width: cellWidth - 4 }} title={`Original receipt: day ${p.start + 1}`} />)}
                  </div>
                </div>
                {(["RX1+RX2", "RX3+RX4"] as Pair[]).map((pair) => (
                  <div className="gantt-row resource" key={pair}>
                    <div className="gantt-label">
                      <Waves size={15} />
                      <strong>{pair}</strong>
                      <small>Cleaning windows</small>
                    </div>
                    <div className="gantt-lane">
                      {days.map((d) => (
                        <div
                          className={`gantt-cell ${isWeekend(d.date) ? "weekend" : ""}`}
                          style={{ left: d.day * cellWidth, width: cellWidth }}
                          key={d.day}
                        />
                      ))}
                      {viewPlan.cleanings
                        .filter((c) => c.pair === pair)
                        .map((c) => itemElement("cleaning", c))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </DndContext>
          <div className="gantt-footer">
            <span>
              <i className="legend-campaign" />
              Production
            </span>
            <span>
              <Package size={12} />
              Simulated due date
            </span>
            <span>
              <ShoppingCart size={12} />
              RM arrival
            </span>
            <span>
              <Waves size={12} />
              Cleaning
            </span>
            <button
              onClick={() => {
                setConfirmReset("source");
              }}
            >
              Restore original shared scenario
              <ArrowRight size={12} />
            </button>
          </div>
        </section>
        <aside className="manual-editor">
          <div
            className="manual-tabs"
            role="tablist"
            aria-label="Manual plan tools"
          >
            {(["edit", "checks", "assumptions"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t === "edit"
                  ? "Edit event"
                  : t === "checks"
                    ? `Checks (${current.issues.length})`
                    : "Assumptions"}
              </button>
            ))}
          </div>
          {tab === "edit" && (
            <div className="editor-content">
              {selectedItem && selection ? (
                <>
                  <div className="editor-event-title">
                    <span>
                      {selection.kind === "campaign"
                        ? "Production campaign"
                        : selection.kind === "purchase"
                          ? "Raw material arrival"
                          : selection.kind === "cleaning"
                            ? "Reactor cleaning"
                            : "Delivery commitment"}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="Deselect event"
                      title="Deselect event"
                      onClick={() => setSelection(null)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {"grade" in selectedItem && (
                    <label className="manual-field">
                      <span>Product group</span>
                      <select
                        aria-label="Selected event grade"
                        value={selectedItem.grade}
                        onChange={(e) =>
                          patchItem({ grade: e.target.value as Grade })
                        }
                      >
                        {GRADE_RULES.map((g) => (
                          <option key={g.id}>{g.id}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {"pair" in selectedItem && (
                    <label className="manual-field">
                      <span>Reactor pair</span>
                      <select
                        value={selectedItem.pair}
                        onChange={(e) =>
                          patchItem({ pair: e.target.value as Pair })
                        }
                      >
                        <option>RX1+RX2</option>
                        <option>RX3+RX4</option>
                      </select>
                    </label>
                  )}
                  <label className="manual-field">
                    <span>
                      {selection.kind === "delivery"
                        ? "Due date"
                        : selection.kind === "purchase"
                          ? "Arrival date"
                          : "Start date"}
                    </span>
                    <input
                      type="date"
                      aria-label="Event date"
                      value={dateAt(draft.startDate, selectedItem.start)}
                      min={draft.startDate}
                      max={dateAt(
                        draft.startDate,
                        draft.days -
                          ("duration" in selectedItem
                            ? selectedItem.duration
                            : 1),
                      )}
                      onChange={(e) => {
                        if (e.target.value)
                          commit(
                            shift(
                              draft,
                              selection,
                              dayAt(draft.startDate, e.target.value),
                            ),
                          );
                      }}
                    />
                  </label>
                  {"duration" in selectedItem &&
                    fields(
                      "Duration / calendar days",
                      selectedItem.duration,
                      (n) => patchItem({ duration: n }),
                      1,
                      draft.days - selectedItem.start,
                    )}
                  {"tons" in selectedItem &&
                    fields(
                      "Quantity / tonnes",
                      selectedItem.tons,
                      (n) => patchItem({ tons: n }),
                      0,
                      100000,
                      10,
                    )}
                  {selection.kind === "purchase" && (
                    <>
                      <label className="manual-check">
                        <input
                          type="checkbox"
                          checked={(selectedItem as Purchase).price === null}
                          onChange={(e) =>
                            patchItem({
                              price: e.target.checked
                                ? null
                                : assumptions.monthlyPrices[
                                    dateAt(
                                      draft.startDate,
                                      selectedItem.start,
                                    ).slice(0, 7)
                                  ] || 1500,
                            })
                          }
                        />
                        Follow monthly demo BD prices
                      </label>
                      {(selectedItem as Purchase).price !== null ? (
                        fields(
                          "Fixed quote / USD per tonne",
                          (selectedItem as Purchase).price!,
                          (n) => patchItem({ price: n }),
                          0,
                        )
                      ) : (
                        <div className="event-fact">
                          Demo receipt-month price{" "}
                          <strong>
                            $
                            {fmt(
                              assumptions.monthlyPrices[
                                dateAt(
                                  draft.startDate,
                                  selectedItem.start,
                                ).slice(0, 7)
                              ] || 1500,
                              2,
                            )}
                            /t
                          </strong>
                        </div>
                      )}
                    </>
                  )}
                  {selection.kind === "campaign" && (
                    <div className="event-fact">
                      Normal gross output
                      <strong>
                        {fmt(
                          GRADE_RULES.find(
                            (g) => g.id === (selectedItem as Campaign).grade,
                          )!.capacity * (selectedItem as Campaign).duration,
                        )}{" "}
                        t
                      </strong>
                      <small>
                        Before transition loss, reactor/material availability
                        and {assumptions.lag}-day provisional lag
                      </small>
                    </div>
                  )}
                  <div className="event-nudge">
                    <button
                      className="button"
                      disabled={selectedItem.start === 0}
                      onClick={() =>
                        commit(shift(draft, selection, selectedItem.start - 1))
                      }
                    >
                      <ChevronLeft size={16} />1 day
                    </button>
                    <button
                      className="button"
                      disabled={
                        selectedItem.start +
                          ("duration" in selectedItem
                            ? selectedItem.duration
                            : 1) >=
                        draft.days
                      }
                      onClick={() =>
                        commit(shift(draft, selection, selectedItem.start + 1))
                      }
                    >
                      1 day
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <button className="button delete-event" onClick={remove}>
                    <Trash2 size={15} />
                    Delete event
                  </button>
                  {selection.kind === "campaign" && (
                    <div className="campaign-swap">
                      <span>Campaign sequence</span>
                      <div>
                        <button
                          className="button"
                          onClick={() => swapCampaign(-1)}
                          disabled={draft.campaigns.every(
                            (c) => c.start >= selectedItem.start,
                          )}
                        >
                          <ArrowLeftRight size={14} />
                          Swap earlier
                        </button>
                        <button
                          className="button"
                          onClick={() => swapCampaign(1)}
                          disabled={draft.campaigns.every(
                            (c) => c.start <= selectedItem.start,
                          )}
                        >
                          Swap later
                          <ArrowLeftRight size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="editor-empty">
                  <Settings2 size={28} />
                  <h3>No event selected</h3>
                  <span>{dateAt(draft.startDate, selectedDay)}</span>
                  <div className="day-summary">
                    <div>
                      Production
                      <strong>{fmt(selectedBalance?.produced || 0)} t</strong>
                    </div>
                    <div>
                      Due demand
                      <strong>{fmt(selectedBalance?.demand || 0)} t</strong>
                    </div>
                    <div>
                      Shortage
                      <strong>{fmt(selectedBalance?.shortage || 0)} t</strong>
                    </div>
                    <div>
                      RM stock
                      <strong>{fmt(selectedBalance?.raw || 0)} t</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {tab === "checks" && (
            <div className="editor-content check-content">
              <div className="check-summary">
                <AlertTriangle size={17} />
                {conflicts.length} conflicts /{" "}
                {current.issues.length - conflicts.length} advisory findings
              </div>
              {Array.from(warningGroups.values()).map((issue, i) => (
                <button
                  key={i}
                  className={`plan-issue ${issue.severity}`}
                  onClick={() => jump(issue.day)}
                >
                  <span>
                    {shortDate(dateAt(draft.startDate, issue.day))}
                    {issue.days.length > 1
                      ? ` + ${issue.days.length - 1} days`
                      : ""}
                  </span>
                  <strong>{issue.text}</strong>
                </button>
              ))}
              <div className="check-limit">
                No OT. Full grade-change Excel, transition split, initial
                reactor state and complete cycle ordering remain unverified.
              </div>
            </div>
          )}
          {tab === "assumptions" && (
            <div className="editor-content assumptions-content">
              <div className="assumption-warning">
                All values below are simulation assumptions, not
                company-approved master data.
              </div>
              {fields(
                "Production lag / calendar days (provisional)",
                assumptions.lag,
                (n) => config("lag", n),
                0,
                14,
              )}
              {fields("Initial RM / tonnes", assumptions.initialRaw, (n) =>
                config("initialRaw", n),
              )}
              {fields(
                "RM storage limit / tonnes",
                assumptions.rawCapacity,
                (n) => config("rawCapacity", n),
                1,
              )}
              {fields(
                "Simulated demand change / %",
                assumptions.demandChange,
                (n) => config("demandChange", n),
                -20,
                30,
              )}
              <h3>Initial finished-goods stock / tonnes</h3>
              {GRADE_RULES.map((g) =>
                fields(g.id, assumptions.initialStock[g.id], (n) =>
                  setAssumptions((a) => ({
                    ...a,
                    initialStock: { ...a.initialStock, [g.id]: n },
                  })),
                ),
              )}
              <h3>Reactor ages / operating days</h3>
              {fields(
                "RX1+RX2 initial age (unverified)",
                assumptions.age12,
                (n) => config("age12", n),
                0,
                60,
              )}
              {fields(
                "RX3+RX4 initial age (unverified)",
                assumptions.age34,
                (n) => config("age34", n),
                0,
                60,
              )}
              <h3>Illustrative USD cost rates</h3>
              {fields(
                "FG holding / tonne / day",
                assumptions.fgHoldingDaily,
                (n) => config("fgHoldingDaily", n),
                0,
                1000,
                0.1,
              )}
              {fields(
                "RM holding / tonne / day",
                assumptions.rawHoldingDaily,
                (n) => config("rawHoldingDaily", n),
                0,
                1000,
                0.1,
              )}
              {fields(
                "Unmet-demand penalty / tonne",
                assumptions.shortagePenalty,
                (n) => config("shortagePenalty", n),
                0,
              )}
              {fields(
                "Production / tonne",
                assumptions.productionCost,
                (n) => config("productionCost", n),
                0,
              )}
              {fields(
                "Setup / campaign",
                assumptions.setupCost,
                (n) => config("setupCost", n),
                0,
              )}
              <h3>Monthly demo BD prices / USD per tonne</h3>
              {Object.entries(assumptions.monthlyPrices).map(([m, p]) =>
                fields(m, p, (n) =>
                  setAssumptions((a) => ({
                    ...a,
                    monthlyPrices: { ...a.monthlyPrices, [m]: n },
                  })),
                ),
              )}
              <div className="check-limit">
                Market reference ≠ actual supplier purchase quote. Company
                holidays beyond weekends are not loaded. Assumption edits apply
                to the shared draft; original baseline assumptions stay fixed.
              </div>
            </div>
          )}
        </aside>
      </div>
      <section className="manual-impact">
        <div className="manual-impact-heading">
          <div>
            <span>DAILY CONSEQUENCES</span>
            <h2>Inventory & delivery exposure</h2>
          </div>
          <div>
            <i className="impact-line fg" />
            FG stock
            <i className="impact-line raw" />
            RM stock
            <i className="impact-line baseline" />
            Baseline FG
            <i className="impact-bar" />
            Unmet demand
          </div>
        </div>
        <div className="manual-balance-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chart}
              margin={{ top: 12, bottom: 5, left: 0, right: 14 }}
            >
              <CartesianGrid stroke="#e8eee7" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                minTickGap={65}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#82927e" }}
              />
              <YAxis
                tickFormatter={(v) => fmt(v)}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#82927e" }}
              />
              <Tooltip
                labelFormatter={(v) => String(v)}
                formatter={(v: any, name: any) => [
                  `${fmt(Number(v), 1)} t`,
                  name,
                ]}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 6,
                  borderColor: "#dfe7dc",
                }}
              />
              <Area
                dataKey="fg"
                name="FG stock"
                stroke="#208568"
                fill="#e1efe5"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Line
                dataKey="raw"
                name="RM stock"
                stroke="#5098ae"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="baselineFG"
                name="Baseline FG"
                stroke="#a7b5a1"
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
              <Bar
                dataKey="shortage"
                name="Unmet demand"
                fill="#da9a68"
                maxBarSize={14}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="manual-impact-footer">
          <span>
            {current.changeovers} grade changes / {fmt(current.transitionLoss)}{" "}
            t estimated transition loss
          </span>
          <span>{fmt(current.unfinishedWip)} t matures beyond horizon</span>
          <span>
            Fulfillment is simulated on due date / shortage treated as lost
            sales
          </span>
        </div>
      </section>
      <section className="manual-ledger">
        <div>
          <h2>Delivery impact by grade</h2>
          <span>Shared vs original / assumptions may differ</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Demand due</th>
                <th>Unmet demand</th>
                <th>Baseline shortage</th>
                <th>Change</th>
                <th>Ending FG</th>
              </tr>
            </thead>
            <tbody>
              {GRADE_RULES.map((g) => {
                const shortage = current.daily.reduce(
                  (s, d) => s + d.gradeShortage[g.id],
                  0,
                );
                const old = previous.daily.reduce(
                  (s, d) => s + d.gradeShortage[g.id],
                  0,
                );
                const demand = viewPlan.deliveries
                  .filter((d) => d.grade === g.id)
                  .reduce(
                    (s, d) => s + d.tons * (1 + assumptions.demandChange / 100),
                    0,
                  );
                return (
                  <tr key={g.id}>
                    <td>
                      <i
                        className="table-dot"
                        style={{ background: COLORS[g.id] }}
                      />
                      {g.id}
                    </td>
                    <td>{fmt(demand)} t</td>
                    <td>{fmt(shortage, 1)} t</td>
                    <td>{fmt(old, 1)} t</td>
                    <td className={shortage <= old ? "better" : "worse"}>
                      {shortage > old ? "+" : ""}
                      {fmt(shortage - old, 1)} t
                    </td>
                    <td>
                      {fmt(
                        current.daily[current.daily.length - 1]?.stock[g.id] ||
                          0,
                      )}{" "}
                      t
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {note && (
        <div className="manual-note" role="status">
          <Check size={15} />
          {note}
          <button
            aria-label="Dismiss manual plan notice"
            onClick={() => setNote("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="live-impact-dock" aria-label="Live plan differences"><strong>{preview ? 'LIVE DRAG PREVIEW' : 'SHARED PLAN / VS ORIGINAL'}</strong><span>Dispatch fulfilment<b>{(current.service - previous.service).toFixed(1)} pp</b></span><span>Unserved demand<b>{(current.totalShortage - previous.totalShortage).toFixed(0)} t</b></span><span>Cost / penalty excluded<b>${(scenario.current.costExcludingPenalty - scenario.baseline.costExcludingPenalty).toLocaleString('en-US', { maximumFractionDigits: 0 })}</b></span><span>Conflicts<b>{current.issues.filter(i => i.severity === 'conflict').length}</b></span></div>
      {confirmReset && (
        <div className="manual-confirm-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Replace manual draft"
            className="manual-confirm"
            ref={confirmation}
          >
            <h2>Reset the shared scenario?</h2>
            <p>Restore original mock campaigns, shipments, orders and assumptions across all views. This does not run a scheduling solver. Undo remains available.</p>
            <div>
              <button className="button" onClick={() => setConfirmReset(null)}>
                Cancel
              </button>
              <button
                className="button green"
                onClick={() => reset(confirmReset)}
              >
                Confirm
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
