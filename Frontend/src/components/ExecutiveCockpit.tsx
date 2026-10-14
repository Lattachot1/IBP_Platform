"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Factory,
  FileText,
  Focus,
  Globe2,
  Layers3,
  Package,
  Pause,
  Play,
  Presentation,
  RotateCcw,
  ShieldAlert,
  Timer,
  TrendingUp,
  Waves,
  X,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildExecutiveExperiment,
  cashComponents,
  ExecutiveShock,
  reactorSnapshot,
  SHOCK_PRESETS,
} from "../lib/executiveDemo";
import { dateAt } from "../lib/manualPlanning";
import { executiveBriefHtml } from "../lib/executiveBrief";

const FactoryTwin = dynamic(() => import("./FactoryTwin"), { ssr: false });
const nf = (v: number, digits = 0) =>
  v.toLocaleString("en-US", { maximumFractionDigits: digits });
const money = (v: number) => `$${nf(v / 1e6, 2)}M`;
const date = (start: string, day: number) =>
  new Date(`${dateAt(start, day)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const STEPS = ["Situation", "Disruption", "Responses", "Next decisions"];
const DECISIONS = [
  {
    id: "supply",
    owner: "Procurement",
    name: "Confirm supplier recovery dates",
    detail: "Lead time, availability and any expediting quote.",
  },
  {
    id: "delivery",
    owner: "Commercial",
    name: "Confirm customer commitments",
    detail: "Original due dates vs any accepted extensions.",
  },
  {
    id: "factory",
    owner: "Production",
    name: "Validate the executable schedule",
    detail: "Grade transitions, reactor cycle, cleaning and opening WIP.",
  },
  {
    id: "finance",
    owner: "Finance",
    name: "Replace mock financial assumptions",
    detail: "Purchase, holding, production and intervention costs.",
  },
];
type Props = {
  active: boolean;
  onNavigate: (view: "timeline" | "logistics" | "lab" | "overview") => void;
};
function IconTool({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className="icon-button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function ExecutiveCockpit({ active, onNavigate }: Props) {
  const [shock, setShock] = useState<ExecutiveShock>({
    demandPct: 0,
    pricePct: 0,
    receiptDelay: 0,
  });
  const [optionId, setOptionId] = useState("hold");
  const [day, setDay] = useState(41);
  const [playing, setPlaying] = useState(false);
  const [reactorId, setReactorId] = useState("RX1");
  const [twinView, setTwinView] = useState<"plant" | "top">("plant");
  const [resetView, setResetView] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [step, setStep] = useState(0);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const experiment = useMemo(() => buildExecutiveExperiment(shock), [shock]);
  const selected = experiment.options.find((o) => o.id === optionId)!;
  const baseline = experiment.baseline.evaluation;
  const result = selected.evaluation;
  const snapshot = result.daily[day];
  const reactors = useMemo(
    () => reactorSnapshot(selected.plan, result, day),
    [selected, day, result],
  );
  const reactor = reactors.find((r) => r.id === reactorId)!;
  const conflicts = result.issues.filter((i) => i.severity === "conflict");
  const checks = new Set(conflicts.map((i) => i.code)).size;
  const deferredReceipts = selected.plan.purchases
    .filter((p) => p.start >= selected.plan.days)
    .reduce((s, p) => s + p.tons, 0);
  const priceOnly =
    shock.pricePct > 0 && !shock.demandPct && !shock.receiptDelay;
  const activePreset = SHOCK_PRESETS.find(
    (p) => JSON.stringify(p.shock) === JSON.stringify(shock),
  );
  const currentCampaign = selected.plan.campaigns.find(
    (c) => day >= c.start && day < c.start + c.duration,
  );
  const costDelta = selected.costExcludingPenalty - experiment.cashLikeBase;
  const chart = result.daily.map((d) => ({
    date: date(selected.plan.startDate, d.day),
    stock: d.fg,
    raw: d.raw,
    missed: d.shortage,
    baseStock: baseline.daily[d.day].fg,
  }));
  const selectedCosts = cashComponents(selected);
  const baseCost = baseline.costBreakdown;
  const deltas = [
    { name: "Base", value: experiment.cashLikeBase, total: true },
    {
      name: "RM buy",
      value: result.costBreakdown.purchases - baseCost.purchases,
    },
    {
      name: "Production",
      value: result.costBreakdown.production - baseCost.production,
    },
    { name: "Setups", value: result.costBreakdown.setups - baseCost.setups },
    {
      name: "Holding",
      value:
        result.costBreakdown.fgHolding +
        result.costBreakdown.rawHolding -
        baseCost.fgHolding -
        baseCost.rawHolding,
    },
    { name: "Action", value: selected.interventionCost },
    { name: "Scenario", value: selected.costExcludingPenalty, total: true },
  ];
  let runningCost = experiment.cashLikeBase;
  const bridge = deltas.map((d, i) => {
    const offset = d.total
      ? 0
      : d.value >= 0
        ? runningCost
        : runningCost + d.value;
    if (!d.total) runningCost += d.value;
    return {
      ...d,
      offset,
      amount: Math.abs(d.value),
      color: d.total
        ? i === 0
          ? "#789587"
          : "#258c79"
        : d.value >= 0
          ? "#d58c6c"
          : "#6aa1b2",
    };
  });
  useEffect(() => {
    if (!active) {
      setPlaying(false);
      setPresenting(false);
    }
  }, [active]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setDay((d) => Math.min(experiment.baseline.plan.days - 1, d + 1)),
      850,
    );
    return () => clearInterval(timer);
  }, [playing, experiment.baseline.plan.days]);
  useEffect(() => {
    if (day >= experiment.baseline.plan.days - 1) setPlaying(false);
  }, [day, experiment.baseline.plan.days]);
  useEffect(() => {
    if (!presenting) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresenting(false);
      if (event.key !== "Tab") return;
      const items = Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, textarea, select, [tabindex="0"]',
        ) || [],
      ).filter((e) => e.getClientRects().length > 0);
      if (!items.length) return;
      if (
        event.shiftKey &&
        (document.activeElement === items[0] ||
          document.activeElement === root.current)
      ) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === items[items.length - 1] ||
          document.activeElement === root.current)
      ) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handler);
      previousFocus?.focus();
    };
  }, [presenting]);
  const moveStep = (next: number) => {
    setStep(next);
    if (!presenting)
      sections.current[next]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    else root.current?.scrollTo({ top: 0 });
  };
  const selectPreset = (value: ExecutiveShock) => {
    setShock({ ...value });
    setOptionId("hold");
  };
  const reset = () => {
    selectPreset({ demandPct: 0, pricePct: 0, receiptDelay: 0 });
    setDay(41);
    setPlaying(false);
  };
  const exportBrief = () => {
    const payload = {
      status: "illustrative_executive_brief_not_approved_factory_plan",
      exported_at: new Date().toISOString(),
      scope:
        "Standalone September-October 2026 mock with seven-day common evaluation tail; independent of API optimizer, manual drafts and logistics mock.",
      shock,
      selected_response: selected.id,
      day,
      baseline: experiment.baseline,
      assumptions: experiment.assumptions,
      options: experiment.options,
      reviews_for_discussion_only: reviewed,
      meeting_note: note,
      caveats: [
        "Not an optimization run. These are three deterministic what-if candidates.",
        "All dates, costs, volumes, opening stocks and interventions are illustrative.",
        "Production lag is three calendar days provisionally. No OT.",
        "No guarantee of zero shortage, full feasibility or realized financial savings.",
        "Cost headline excludes shortage penalty and is not an audited cash-flow calculation or profit.",
        "Delivery-extension service is against revised dates, not original customer commitments. Every original ton remains in the common evaluation horizon.",
        "Restoring receipt dates requires supplier confirmation and the USD 35/t premium is mock.",
        "Factory geometry and movement are schematic, not telemetry or an as-built model.",
        "Review checkboxes record discussion, not company approval or dispatch.",
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "ube-executive-brief.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const jump = (view: "timeline" | "logistics" | "lab") => {
    setPresenting(false);
    onNavigate(view);
  };
  const exportReadableBrief = () => {
    const html = executiveBriefHtml({
      shock,
      options: experiment.options,
      selectedId: selected.id,
      baselineCost: experiment.cashLikeBase,
      reviewed,
      note,
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ube-board-brief.html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!active) return null;
  return (
    <div
      ref={root}
      tabIndex={-1}
      className={`executive-cockpit ${presenting ? "exec-presenting" : ""}`}
      role={presenting ? "dialog" : undefined}
      aria-modal={presenting ? true : undefined}
      aria-label={presenting ? "Executive presentation" : undefined}
    >
      <div className="exec-toolbar">
        <div>
          <span className="label-chip amber">STANDALONE MOCK</span>
          <span className="exec-assumptions">
            No OT / lag 3d provisional / +7d delivery tail
          </span>
        </div>
        <div>
          <IconTool label="Reset executive scenario" onClick={reset}>
            <RotateCcw size={17} />
          </IconTool>
          <IconTool
            label="Export executive scenario data"
            onClick={exportBrief}
          >
            <Download size={17} />
          </IconTool>
          <button className="button" onClick={exportReadableBrief}>
            <FileText size={15} />
            Board brief
          </button>
          <button
            className="button dark"
            aria-pressed={presenting}
            onClick={() => setPresenting((p) => !p)}
          >
            {presenting ? <X size={16} /> : <Presentation size={16} />}
            {presenting ? "Exit presentation" : "Present"}
          </button>
        </div>
      </div>
      <div
        className="exec-story-nav"
        role="group"
        aria-label="Executive story chapters"
      >
        {STEPS.map((name, i) => (
          <button
            key={name}
            aria-pressed={step === i}
            onClick={() => moveStep(i)}
          >
            <span>0{i + 1}</span>
            {name}
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      <div className="exec-metrics">
        <div>
          <span>Modeled cost / excl. shortage penalty</span>
          <strong data-testid="exec-cost">
            {money(selected.costExcludingPenalty)}
          </strong>
          <small className={costDelta > 1 ? "exec-risk-text" : ""}>
            {Math.abs(costDelta) < 1
              ? "Base mock cost"
              : `${costDelta > 0 ? "+" : "-"}${money(Math.abs(costDelta))} vs original base`}
          </small>
        </div>
        <div>
          <span>Delivery fulfilment / full horizon</span>
          <strong data-testid="exec-service">
            {nf(result.service, 1)}
            <em>%</em>
          </strong>
          <small>
            {selected.id === "reschedule"
              ? "Against revised dates / customer agreement needed"
              : `Against original dates / base ${nf(baseline.service, 1)}%`}
          </small>
        </div>
        <div>
          <span>Unserved demand</span>
          <strong>
            {nf(result.totalShortage)}
            <em>t</em>
          </strong>
          <small>
            {nf(result.totalDemand)} t required / all quantities counted
          </small>
        </div>
        <div>
          <span>Implemented rule conflicts</span>
          <strong>
            {checks}
            <em>types</em>
          </strong>
          <small>Full factory feasibility remains unverified</small>
        </div>
      </div>
      {(!presenting || step === 0) && (
        <section
          className="exec-situation"
          ref={(element) => {
            sections.current[0] = element;
          }}
        >
          <div className="exec-situation-head">
            <div>
              <span className="eyebrow">THE OPERATING PICTURE</span>
              <h2>
                {activePreset?.id === "normal"
                  ? "Volume is not the whole story."
                  : priceOnly
                    ? "Higher prices. The same production clock."
                    : shock.receiptDelay > 0
                      ? "Late material. Downstream consequences."
                      : "More demand. The same production clock."}
              </h2>
            </div>
            <span className="source-badge muted">
              Illustrative state / not live telemetry
            </span>
          </div>
          <div className="exec-plant-layout">
            <div className="exec-plant-stage">
              <FactoryTwin
                reactors={reactors}
                raw={snapshot.raw}
                fg={snapshot.fg}
                producing={snapshot.produced}
                selected={reactorId}
                view={twinView}
                reset={resetView}
                onSelect={setReactorId}
              />
              <div className="exec-plant-overlay">
                <span>
                  <Factory size={14} />
                  TSL / CONCEPTUAL PROCESS VIEW
                </span>
                <div>
                  <IconTool
                    label="Top-down factory view"
                    pressed={twinView === "top"}
                    onClick={() =>
                      setTwinView((v) => (v === "top" ? "plant" : "top"))
                    }
                  >
                    <Layers3 size={17} />
                  </IconTool>
                  <IconTool
                    label="Reset factory camera"
                    onClick={() => setResetView((v) => v + 1)}
                  >
                    <Focus size={17} />
                  </IconTool>
                </div>
              </div>
              <div className="exec-plant-date">
                <strong>{date(selected.plan.startDate, day)} 2026</strong>
                <span>End-of-day simulation</span>
              </div>
              <div className="exec-plant-legend">
                <span>
                  <i />
                  Producing
                </span>
                <span>
                  <i className="cleaning" />
                  Cleaning
                </span>
                <span>
                  <i className="hold" />
                  Material hold
                </span>
                <span>Not an as-built layout</span>
              </div>
            </div>
            <aside className="exec-reactor-inspector">
              <span className="eyebrow">REACTOR STATE</span>
              <h3>{reactor.id}</h3>
              <span
                className={`exec-reactor-state ${reactor.status.replace(/ /g, "-").toLowerCase()}`}
              >
                {reactor.status}
              </span>
              <div className="exec-reactor-detail">
                <span>
                  Pair<strong>{reactor.pair}</strong>
                </span>
                <span>
                  Operating age<strong>{reactor.age} days</strong>
                </span>
                <span>
                  Planned grade
                  <strong>{currentCampaign?.grade || "No campaign"}</strong>
                </span>
                <span>
                  Credited daily output
                  <strong>{nf(snapshot.produced)} t</strong>
                </span>
              </div>
              <div className="exec-reactor-picker">
                {reactors.map((r) => (
                  <button
                    key={r.id}
                    aria-label={`Select ${r.id} reactor`}
                    aria-pressed={reactorId === r.id}
                    onClick={() => setReactorId(r.id)}
                  >
                    <i className={r.status.replace(/ /g, "-").toLowerCase()} />
                    {r.id}
                    <span>{r.status}</span>
                  </button>
                ))}
              </div>
              <small>
                Colors and movement reflect this simulator only. No factory
                sensors connected.
              </small>
            </aside>
          </div>
          <div className="exec-process-strip">
            {[
              {
                icon: Waves,
                label: "Raw stock",
                value: `${nf(snapshot.raw)} t`,
              },
              {
                icon: Factory,
                label: "Daily production",
                value: `${nf(snapshot.produced)} t`,
              },
              { icon: Timer, label: "Release lag", value: "3 calendar days" },
              {
                icon: Boxes,
                label: "Finished goods",
                value: `${nf(snapshot.fg)} t`,
              },
              {
                icon: Package,
                label: "Daily deliveries",
                value: `${nf(snapshot.delivered)} t`,
              },
            ].map((item, i) => (
              <div key={item.label}>
                <item.icon size={19} />
                <span>
                  {item.label}
                  <strong>{item.value}</strong>
                </span>
                {i < 4 && <ArrowRight size={14} />}
              </div>
            ))}
          </div>
          <div className="exec-time">
            <IconTool
              label={
                playing ? "Pause factory playback" : "Play factory playback"
              }
              pressed={playing}
              onClick={() => {
                if (day === selected.plan.days - 1) setDay(0);
                setPlaying((v) => !v);
              }}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </IconTool>
            <input
              type="range"
              aria-label="Factory snapshot day"
              min="0"
              max={selected.plan.days - 1}
              value={day}
              onChange={(e) => {
                setPlaying(false);
                setDay(Number(e.target.value));
              }}
            />
            <span>{date(selected.plan.startDate, day)}</span>
          </div>
        </section>
      )}
      {(!presenting || step === 1) && (
        <section
          className="exec-disruption"
          ref={(element) => {
            sections.current[1] = element;
          }}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">PRESSURE TEST</span>
              <h2>Change the conditions. See the exposure.</h2>
            </div>
            <span className="source-badge muted">
              Deterministic what-if / not a probability forecast
            </span>
          </div>
          <div className="exec-presets">
            {SHOCK_PRESETS.map((p) => (
              <button
                key={p.id}
                aria-pressed={activePreset?.id === p.id}
                onClick={() => selectPreset(p.shock)}
              >
                {p.id === "price" ? (
                  <Waves size={19} />
                ) : p.id === "rush" ? (
                  <TrendingUp size={19} />
                ) : p.id === "delay" ? (
                  <Timer size={19} />
                ) : p.id === "combined" ? (
                  <ShieldAlert size={19} />
                ) : (
                  <Factory size={19} />
                )}
                <strong>{p.name}</strong>
                <small>{p.detail}</small>
              </button>
            ))}
          </div>
          <div className="exec-shock-controls">
            {[
              {
                key: "demandPct" as const,
                label: "Delivery demand change",
                unit: "%",
                max: 40,
              },
              {
                key: "pricePct" as const,
                label: "Butadiene purchase price change",
                unit: "%",
                max: 50,
              },
              {
                key: "receiptDelay" as const,
                label: "Raw material receipt delay",
                unit: "d",
                max: 20,
              },
            ].map((control) => (
              <label key={control.key}>
                {control.label}
                <strong>
                  +{shock[control.key]}
                  {control.unit}
                </strong>
                <input
                  type="range"
                  aria-label={control.label}
                  min="0"
                  max={control.max}
                  value={shock[control.key]}
                  onChange={(e) =>
                    setShock((s) => ({
                      ...s,
                      [control.key]: Number(e.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="exec-analytics">
            <div>
              <div className="exec-chart-heading">
                <h3>Stock & missed deliveries</h3>
                <span>
                  Base FG <i className="base" />
                  Scenario FG <i className="fg" />
                  RM <i className="raw" />
                </span>
              </div>
              <div className="exec-stock-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chart}
                    margin={{ top: 14, right: 15, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid stroke="#e1e9e3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#819589" }}
                      minTickGap={42}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#819589" }}
                      tickFormatter={(n) => nf(n)}
                      width={48}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(v, n) => [`${nf(Number(v))} t`, n]}
                      contentStyle={{ fontSize: 11, borderRadius: 4 }}
                    />
                    <Area
                      dataKey="stock"
                      name="Scenario FG stock"
                      fill="#d9eee4"
                      stroke="#359e82"
                      strokeWidth={2}
                    />
                    <Line
                      dataKey="baseStock"
                      name="Original base FG stock"
                      stroke="#8ca59a"
                      strokeDasharray="4 4"
                      dot={false}
                    />
                    <Line
                      dataKey="raw"
                      name="RM stock"
                      stroke="#619bab"
                      dot={false}
                      strokeWidth={1.5}
                    />
                    <Bar
                      dataKey="missed"
                      name="Missed deliveries"
                      fill="#d28a70"
                      barSize={6}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <div className="exec-chart-heading">
                <h3>Where the cost changes</h3>
                <span>USD / shortage penalty excluded</span>
              </div>
              <div className="exec-cost-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={bridge}
                    margin={{ top: 15, right: 5, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid stroke="#e1e9e3" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9, fill: "#718678" }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis
                      tickFormatter={(n) => `$${nf(n / 1e6)}M`}
                      tick={{ fontSize: 10, fill: "#819589" }}
                      width={45}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={({ active: shown, payload }) =>
                        shown && payload?.length ? (
                          <div className="exec-chart-tooltip">
                            <strong>{payload[0].payload.name}</strong>
                            <span>
                              {payload[0].payload.total ? "Total" : "Change"}: $
                              {nf(payload[0].payload.value)}
                            </span>
                          </div>
                        ) : null
                      }
                    />
                    <Bar
                      dataKey="offset"
                      stackId="bridge"
                      fill="transparent"
                      legendType="none"
                    />
                    <Bar dataKey="amount" stackId="bridge" barSize={32}>
                      {bridge.map((item) => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="exec-cost-key">
                {selectedCosts.map((c) => (
                  <span key={c.name}>
                    <i style={{ background: c.color }} />
                    {c.name}
                    <strong>${nf(c.value / 1000, 1)}k</strong>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="exec-penalty-note">
            <ShieldAlert size={15} />
            <span>
              Separate modeled shortage penalty:{" "}
              <strong>{money(result.costBreakdown.shortagePenalty)}</strong>.
              Not included in the cost headline; not claimed as an actual cash
              expense.
            </span>
          </div>
          {deferredReceipts > 0 && (
            <div className="exec-penalty-note">
              <Timer size={15} />
              <span>
                {nf(deferredReceipts)} t of planned receipts fall outside
                evaluation. Their purchase cost is excluded, not saved.
              </span>
            </div>
          )}
        </section>
      )}
      {(!presenting || step === 2) && (
        <section
          className="exec-responses"
          ref={(element) => {
            sections.current[2] = element;
          }}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE DECISION TABLE</span>
              <h2>Three responses. Visible trade-offs.</h2>
            </div>
            <span className="source-badge muted">
              Candidates / not solver-optimal or approved
            </span>
          </div>
          <div className="exec-response-grid">
            {experiment.options.map((o, i) => (
              <button
                key={o.id}
                className={`exec-response ${o.id === selected.id ? "selected" : ""}`}
                aria-pressed={o.id === selected.id}
                onClick={() => setOptionId(o.id)}
              >
                <span className="exec-response-top">
                  0{i + 1}
                  {o.id === selected.id && <Check size={16} />}
                </span>
                <h3>{o.name}</h3>
                <div className="exec-response-main">
                  <strong>{money(o.costExcludingPenalty)}</strong>
                  <span>Cost excluding shortage penalty</span>
                </div>
                <div className="exec-response-stats">
                  <span>
                    Fulfilment<strong>{nf(o.evaluation.service, 1)}%</strong>
                  </span>
                  <span>
                    Unserved<strong>{nf(o.evaluation.totalShortage)} t</strong>
                  </span>
                </div>
                <span
                  className={`exec-response-dates ${o.id === "reschedule" ? "revised" : ""}`}
                >
                  {o.id === "reschedule"
                    ? "Revised dates (+7d) / not original on-time service"
                    : "Original due dates"}
                </span>
                <p>{o.condition}</p>
                <small>
                  {
                    new Set(
                      o.evaluation.issues
                        .filter((issue) => issue.severity === "conflict")
                        .map((issue) => issue.code),
                    ).size
                  }{" "}
                  conflict types / factory verification pending
                </small>
              </button>
            ))}
          </div>
          <div className="exec-response-caution">
            All original demand remains in the common seven-day evaluation tail.
            Customer extensions change the commitment dates, not demand
            quantity. No automated approval or dispatch.
          </div>
        </section>
      )}
      {(!presenting || step === 3) && (
        <section
          className="exec-decisions"
          ref={(element) => {
            sections.current[3] = element;
          }}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">FROM DISCUSSION TO FOLLOW-UP</span>
              <h2>What needs a decision next?</h2>
            </div>
            <span className="label-chip">
              {Object.values(reviewed).filter(Boolean).length} / 4 discussed
            </span>
          </div>
          <div className="exec-decision-layout">
            <div>
              {DECISIONS.map((decision) => (
                <label key={decision.id} className="exec-decision-row">
                  <input
                    type="checkbox"
                    aria-label={`Discussed: ${decision.name}`}
                    checked={!!reviewed[decision.id]}
                    onChange={(e) =>
                      setReviewed((v) => ({
                        ...v,
                        [decision.id]: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <strong>{decision.name}</strong>
                    <small>{decision.detail}</small>
                  </span>
                  <em>{decision.owner}</em>
                </label>
              ))}
              <label className="exec-meeting-note">
                Meeting note
                <textarea
                  aria-label="Executive meeting note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder=""
                />
              </label>
            </div>
            <div className="exec-drilldown">
              <span className="eyebrow">DEEPER VIEWS</span>
              <button onClick={() => jump("timeline")}>
                <Factory size={20} />
                <span>
                  Production plan<strong>Daily campaigns & stock</strong>
                </span>
                <ArrowRight size={17} />
              </button>
              <button onClick={() => jump("logistics")}>
                <Globe2 size={20} />
                <span>
                  Logistics globe<strong>Separate mock shipping sandbox</strong>
                </span>
                <ArrowRight size={17} />
              </button>
              <button onClick={() => jump("lab")}>
                <Layers3 size={20} />
                <span>
                  Scenario studio
                  <strong>Separate monthly optimizer demo</strong>
                </span>
                <ArrowRight size={17} />
              </button>
              <small>
                No automatic transfer of this cockpit scenario to the other
                sandboxes.
              </small>
            </div>
          </div>
          {result.issues.length > 0 && (
            <details className="exec-findings">
              <summary>
                <ShieldAlert size={16} />
                {result.issues.length} simulator findings / company validation
                pending
              </summary>
              {result.issues.slice(0, 12).map((issue, i) => (
                <div key={`${issue.code}-${i}`}>
                  <span>{date(selected.plan.startDate, issue.day)}</span>
                  <p>{issue.text}</p>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
      {presenting && (
        <div className="exec-present-footer">
          <span>UBE / Executive discussion / illustrative prototype</span>
          <div>
            <IconTool
              label="Previous presentation chapter"
              disabled={step === 0}
              onClick={() => moveStep(step - 1)}
            >
              <ChevronLeft size={18} />
            </IconTool>
            <strong>{step + 1} / 4</strong>
            <IconTool
              label="Next presentation chapter"
              disabled={step === 3}
              onClick={() => moveStep(step + 1)}
            >
              <ChevronRight size={18} />
            </IconTool>
          </div>
        </div>
      )}
    </div>
  );
}
