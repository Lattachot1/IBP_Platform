"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarRange,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Download,
  Factory,
  FlaskConical,
  GitBranch,
  Globe2,
  LayoutDashboard,
  Maximize2,
  Menu,
  Minus,
  Network,
  Package,
  Play,
  Presentation,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Wallet,
  Waves,
  X,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DemandForecastPanel } from "./DemandForecastPanel";
import { ModelPerformancePanel } from "./ModelPerformancePanel";
import { ManualPlanStudio } from "./ManualPlanStudio";
import { LogisticsGlobeStudio } from "./LogisticsGlobeStudio";
import { ExecutiveCockpit } from "./ExecutiveCockpit";
import { ObjectiveWeightsPanel, ObjectiveScorecard } from "./ObjectiveWeightsPanel";
import { OptimizationBeforeAfter } from "./OptimizationBeforeAfter";
import { ObjectiveDecisionLab } from "./ObjectiveDecisionLab";
import { ScenarioProvider } from "./ScenarioContext";
import { ConnectedScenarioBar, ConnectedCockpit, ConnectedLogistics } from "./ConnectedExperience";
import {
  fetchForecast,
  fetchHistory,
  fetchModels,
  ForecastResponse,
  GradeModel,
  HistoryResponse,
} from "../lib/forecastApi";
import {
  OptimizationDemoRequest,
  OptimizationDemoResponse,
  OptimizationStrategy,
  runOptimizationDemo,
  DEFAULT_OBJECTIVE_WEIGHTS,
  normalizeOptimizationRequest,
} from "../lib/optimizationApi";

type View =
  | "executive"
  | "overview"
  | "forecast"
  | "lab"
  | "timeline"
  | "logistics"
  | "network"
  | "models"
  | "runs";
type SavedRun = {
  id: string;
  name: string;
  at: string;
  result: OptimizationDemoResponse;
};
const NAV: { id: View; name: string; icon: LucideIcon; tag?: string }[] = [
  { id: "executive", name: "Executive cockpit", icon: Presentation },
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "forecast", name: "Demand intelligence", icon: TrendingUp },
  { id: "lab", name: "Scenario studio", icon: FlaskConical, tag: "3" },
  { id: "timeline", name: "Interactive plan", icon: CalendarRange },
  { id: "logistics", name: "Logistics globe", icon: Globe2, tag: "MOCK" },
  { id: "network", name: "Decision map", icon: Network },
  { id: "models", name: "Model observatory", icon: Activity },
  { id: "runs", name: "Saved plans", icon: GitBranch },
];
const DEFAULT: OptimizationDemoRequest = {
  strategy: "stochastic",
  demand_adjustment_pct: 0,
  capacity_adjustment_pct: 0,
  raw_price_adjustment_pct: 0,
  shortage_penalty_multiplier: 1,
  service_target_pct: 95,
  objective_weights: { ...DEFAULT_OBJECTIVE_WEIGHTS },
};
const COLORS = [
  "#13876d",
  "#4a94b4",
  "#e89762",
  "#9881ba",
  "#c5a34d",
  "#717d78",
];
const nf = (v: number, digits = 0) =>
  v.toLocaleString("en-US", { maximumFractionDigits: digits });
const money = (v: number) => `$${nf(v / 1e6, 2)}M`;
const period = (v: string) =>
  new Date(`${v}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
const title = (s: string) =>
  s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const STORE = "ube.planning.saved-runs.v1";
const PROCESS = [
  {
    id: "demand",
    name: "Demand",
    icon: TrendingUp,
    caption: "Monthly billing forecast",
    accent: "green",
    detail: "Demand forecasting",
    items: [
      "Source: billing tonnage, net of returns",
      "Point estimates and empirical prediction intervals",
      "Backtested models and a dedicated forecast endpoint",
      "Not yet connected to the optimizer demo",
    ],
  },
  {
    id: "material",
    name: "Butadiene",
    icon: Waves,
    caption: "Low / base / high price",
    accent: "blue",
    detail: "Raw material outlook",
    items: [
      "Reference: FOB Southeast Asia Mid, PA0033242",
      "Price scenarios embedded in the existing prototype",
      "Market assessment is not a supplier purchase quote",
      "Scenario bands are not statistical prediction intervals",
    ],
  },
  {
    id: "production",
    name: "Production",
    icon: Factory,
    caption: "Capacity & campaigns",
    accent: "orange",
    detail: "Production decisions",
    items: [
      "Monthly production quantity by grade",
      "Grade activation and minimum production batches",
      "Daily sequence, transition loss and reactor cleaning not modeled yet",
      "Prototype still permits overtime; company policy: no OT",
    ],
  },
  {
    id: "inventory",
    name: "Inventory",
    icon: Boxes,
    caption: "FG & raw material balance",
    accent: "purple",
    detail: "Inventory decisions",
    items: [
      "Finished-goods balance per grade and scenario",
      "Raw-material purchases and stock balance",
      "Illustrative safety-stock targets",
      "Company I/S ranges need denominator and enforcement confirmation",
    ],
  },
  {
    id: "finance",
    name: "Outcomes",
    icon: Wallet,
    caption: "Cost & service exposure",
    accent: "green",
    detail: "Business outcomes",
    items: [
      "Expected and worst-scenario modeled cost",
      "Expected and worst-scenario service level",
      "Penalty terms are not necessarily cash expenditures",
      "Optimizer costs and constraints remain illustrative",
    ],
  },
];

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={18} />
    </button>
  );
}
function Heading({
  eyebrow,
  name,
  children,
}: {
  eyebrow: string;
  name: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{name}</h2>
      </div>
      {children}
    </div>
  );
}
function Metric({
  label,
  value,
  unit,
  icon: Icon,
  note,
  tone = "green",
}: {
  label: string;
  value: string;
  unit?: string;
  icon: LucideIcon;
  note: string;
  tone?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        <Icon size={17} />
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <div className={`metric-note ${tone}`}>
        <span className="tiny-dot" />
        {note}
      </div>
    </div>
  );
}

function AllocationNode({
  x,
  y,
  width,
  height,
  index,
  payload,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: { name: string; value: number };
}) {
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    index === undefined ||
    !payload
  )
    return null;
  const first = index === 0;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={first ? "#285345" : COLORS[(index - 1) % COLORS.length]}
        rx={3}
      />
      <text
        x={first ? x - 12 : x + width + 12}
        y={y + height / 2 - 3}
        textAnchor={first ? "end" : "start"}
        fontSize={12}
        fill="#526e5c"
        fontWeight={500}
      >
        {payload.name}
      </text>
      <text
        x={first ? x - 12 : x + width + 12}
        y={y + height / 2 + 14}
        textAnchor={first ? "end" : "start"}
        fontSize={10}
        fill="#94a68e"
      >
        {nf(payload.value)} t
      </text>
    </g>
  );
}

function AllocationLink({
  sourceX,
  sourceY,
  sourceControlX,
  targetX,
  targetY,
  targetControlX,
  linkWidth,
  index,
}: any) {
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      stroke={COLORS[index % COLORS.length]}
      strokeWidth={linkWidth}
      fill="none"
      strokeOpacity={0.23}
    />
  );
}

export function PlanningWorkspace() {
  return <ScenarioProvider><PlanningWorkspaceBody /></ScenarioProvider>;
}
function PlanningWorkspaceBody() {
  const [view, setView] = useState<View>("executive");
  const [standalone, setStandalone] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [request, setRequest] = useState<OptimizationDemoRequest>(DEFAULT);
  const [result, setResult] = useState<OptimizationDemoResponse | null>(null);
  const appliedResult = useRef<OptimizationDemoResponse | null>(null);
  const [comparisonReference, setComparisonReference] = useState<OptimizationDemoResponse | null>(null);
  const referencePinned = useRef(false);
  const [pinned, setPinned] = useState(false);
  const acceptResult = (data: OptimizationDemoResponse) => {
    if (!referencePinned.current) setComparisonReference(appliedResult.current || data);
    appliedResult.current = data;
    setResult(data);
  };
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  const [grades, setGrades] = useState<GradeModel[]>([]);
  const [grade, setGrade] = useState("");
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [forecastError, setForecastError] = useState("");
  const [chartLoading, setChartLoading] = useState(true);
  const [saved, setSaved] = useState<SavedRun[]>([]);
  const [toast, setToast] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [inspector, setInspector] = useState<string | null>(null);
  const [alerts, setAlerts] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loadedStorage, setLoadedStorage] = useState(false);
  const [allocationWidth, setAllocationWidth] = useState(1000);
  const runId = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const notify = (message: string) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  };
  const navigate = (next: View) => {
    setView(next);
    setStandalone(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
    setMobileNav(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  async function solve(next: OptimizationDemoRequest) {
    const weights = normalizeOptimizationRequest(next).objective_weights!;
    if (!Object.values(weights).some(weight => weight > 0)) {
      setError("At least one objective weight must be greater than zero.");
      return;
    }
    const id = ++runId.current;
    setBusy(true);
    setError("");
    try {
      const data = await runOptimizationDemo(next);
      if (id === runId.current) {
        acceptResult(data);
        setEngineOnline(true);
      }
    } catch {
      if (id === runId.current) {
        setEngineOnline(false);
        setError(
          "Planning engine unavailable. Previous result, if any, is retained.",
        );
      }
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }
  useEffect(() => {
    const initialView = new URLSearchParams(window.location.search).get("view");
    if (NAV.some((item) => item.id === initialView))
      setView(initialView as View);
    solve(DEFAULT);
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "[]");
      if (Array.isArray(raw))
        setSaved(
          raw.filter(
            (r) => r?.id && r?.result?.selected_plan && r?.result?.input,
          ),
        );
    } catch {
      /* Ignore a damaged local draft. */
    }
    setLoadedStorage(true);
    return () => {
      runId.current++;
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (loadedStorage) {
      try {
        localStorage.setItem(STORE, JSON.stringify(saved));
      } catch {
        notify("Local storage unavailable. Export a copy to keep this plan.");
      }
    }
  }, [saved, loadedStorage]);
  useEffect(() => {
    let active = true;
    fetchModels()
      .then((data) => {
        if (!active) return;
        setGrades(data.models);
        setGrade((current) => current || data.models[0]?.product_id || "");
        setForecastError("");
        if (!data.models.length) {
          setForecastError("No forecast models available.");
          setChartLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setForecastError(
            "Billing forecast unavailable. No sample values are substituted.",
          );
          setChartLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    if (!grade) return;
    let active = true;
    setChartLoading(true);
    setForecastError("");
    Promise.all([fetchHistory(grade), fetchForecast(grade, 2)])
      .then(([h, f]) => {
        if (active) {
          setHistory(h);
          setForecast(f);
        }
      })
      .catch(() => {
        if (active) {
          setForecastError("Unable to load this grade.");
          setHistory(null);
          setForecast(null);
        }
      })
      .finally(() => {
        if (active) setChartLoading(false);
      });
    return () => {
      active = false;
    };
  }, [grade, revision]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setInspector(null);
        setAlerts(false);
        setMobileNav(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!searchOpen && !inspector && !alerts) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, a[href], [tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const elements = focusable();
      if (e.shiftKey && document.activeElement === elements[0]) {
        e.preventDefault();
        elements[elements.length - 1]?.focus();
      }
      if (
        !e.shiftKey &&
        document.activeElement === elements[elements.length - 1]
      ) {
        e.preventDefault();
        elements[0]?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trap);
      previousFocus?.focus();
    };
  }, [searchOpen, inspector, alerts]);
  const plan = result?.selected_plan;
  const dirty =
    !!result && JSON.stringify(normalizeOptimizationRequest(request)) !== JSON.stringify(normalizeOptimizationRequest(result.input));
  const objectiveWeights = { ...DEFAULT_OBJECTIVE_WEIGHTS, ...request.objective_weights };
  const validWeights = Object.values(objectiveWeights).some(weight => weight > 0);
  const chart = useMemo(() => {
    if (!history || !forecast) return [];
    const actual = history.months.slice(-12).map((row) => ({
      period: row.period,
      actual: row.tons as number | null,
      forecast: null as number | null,
      band: null as [number, number] | null,
    }));
    if (actual.length)
      actual[actual.length - 1].forecast = actual[actual.length - 1].actual;
    return [
      ...actual,
      ...forecast.periods.map((p, i) => ({
        period: p,
        actual: null,
        forecast: forecast.forecast_tons[i],
        band: [forecast.lower_tons[i], forecast.upper_tons[i]] as [
          number,
          number,
        ],
      })),
    ];
  }, [history, forecast]);
  const priceChart =
    result?.horizon.map((p, i) => ({
      period: period(p),
      base: result.scenario_definitions.find((s) => s.scenario === "base")
        ?.raw_prices[i],
      band: [
        result.scenario_definitions.find((s) => s.scenario === "low")
          ?.raw_prices[i] || 0,
        result.scenario_definitions.find((s) => s.scenario === "high")
          ?.raw_prices[i] || 0,
      ],
    })) || [];
  const baseline = result?.strategy_comparison.find(
    (s) => s.mode === "deterministic",
  );
  const costDelta =
    baseline && plan
      ? ((baseline.expected_total_cost - plan.expected_total_cost) /
          baseline.expected_total_cost) *
        100
      : 0;
  const production =
    plan?.monthly_plan.reduce((s, m) => s + m.planned_production_tons, 0) || 0;
  const allocation = useMemo(
    () => ({
      nodes: [
        { name: "Production" },
        ...(plan?.product_plan.map((p) => ({ name: p.product })) || []),
      ],
      links:
        plan?.product_plan.map((p, i) => ({
          source: 0,
          target: i + 1,
          value: p.planned_production_tons,
        })) || [],
    }),
    [plan],
  );
  const currentNode = PROCESS.find((n) => n.id === inspector);
  const matching = NAV.filter((n) =>
    n.name.toLowerCase().includes(query.toLowerCase()),
  );
  const matchingGrades = grades.filter((g) =>
    g.product_id.toLowerCase().includes(query.toLowerCase()),
  );
  const sourceLabel = chartLoading
    ? "Loading billing series"
    : forecastError
      ? "Forecast offline"
      : "Billing data connected";
  const save = () => {
    if (!result || busy || dirty) return;
    setSaved((prev) =>
      [
        {
          id: crypto.randomUUID(),
          name: `${title(result.selected_strategy)} / ${result.input.demand_adjustment_pct > 0 ? "+" : ""}${result.input.demand_adjustment_pct}% demand`,
          at: new Date().toISOString(),
          result,
        },
        ...prev,
      ].slice(0, 20),
    );
    notify("Plan saved on this browser.");
  };
  const download = () => {
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            source:
              "Illustrative optimizer; not approved for factory execution",
            ...result,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ube-plan-${result.selected_strategy}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Full plan exported as JSON.");
  };
  const preset = (type: "base" | "demand" | "price") => {
    const next = {
      ...DEFAULT,
      strategy: request.strategy,
      objective_weights: { ...DEFAULT_OBJECTIVE_WEIGHTS, ...request.objective_weights },
      shortage_penalty_multiplier: request.shortage_penalty_multiplier,
      ...(type === "demand"
        ? {
            demand_adjustment_pct: 15,
            capacity_adjustment_pct: -5,
            service_target_pct: 97,
          }
        : type === "price"
          ? { raw_price_adjustment_pct: 15 }
          : {}),
    };
    setRequest(next);
    solve(next);
  };
  const update = (key: keyof OptimizationDemoRequest, value: number) =>
    setRequest((prev) => ({ ...prev, [key]: value }));
  const flow = (expanded = false) => (
    <div className={`decision-flow ${expanded ? "expanded" : ""}`}>
      {PROCESS.map((node, i) => (
        <div className="flow-step" key={node.id}>
          <button
            className={`flow-node ${node.accent}`}
            onClick={() => setInspector(node.id)}
          >
            <span className="node-icon">
              <node.icon size={expanded ? 26 : 22} />
            </span>
            <strong>{node.name}</strong>
            <small>{node.caption}</small>
            <span className="node-index">0{i + 1}</span>
          </button>
          {i < PROCESS.length - 1 && (
            <div className="flow-link">
              <span />
              <ArrowRight size={15} />
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="planning-app">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a href="/" className="brand" aria-label="UBE planning home">
          <span className="brand-word">
            UBE
            <span />
          </span>
          <span className="brand-divider" />
          <span className="brand-descriptor">
            INTELLIGENT
            <br />
            PLANNING
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-mark">
            <Factory size={18} />
          </span>
          <div>
            <strong>TSL Operations</strong>
            <small>Integrated business planning</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={19} />
              <span>{n.name}</span>
              {n.tag && <small>{n.tag}</small>}
              {view === n.id && <span className="active-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plant-photo">
            <img
              src="/images/ube-facility.jpg"
              alt="UBE Group Thailand facility"
            />
            <a
              href="https://www.ube.co.th/"
              target="_blank"
              rel="noreferrer"
              title="Official UBE Group (Thailand) website"
            >
              UBE Group Thailand
              <ArrowUpRight size={12} />
            </a>
          </div>
          <div className="sidebar-meta">
            <span className="tiny-dot" />
            Research prototype<span>v0.2</span>
          </div>
          <div className="profile">
            <span className="avatar">PL</span>
            <div>
              <strong>Planning team</strong>
              <small>TSL / UBE Chemicals</small>
            </div>
            <button
              title="Data & prototype status"
              aria-label="Data and prototype status"
              onClick={() => setAlerts(true)}
            >
              <CircleHelp size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              title="Open navigation"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{NAV.find((n) => n.id === view)?.name}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="search-trigger"
              aria-label="Search workspace"
              onClick={() => {
                setQuery("");
                setSearchOpen(true);
              }}
            >
              <Search size={16} />
              <span>Search workspace</span>
            </button>
            <div
              className={`connection ${engineOnline ? "online" : "offline"}`}
            >
              <span className="tiny-dot" />
              {engineOnline === null
                ? "Connecting engine"
                : engineOnline
                  ? "Engine connected"
                  : "Engine unavailable"}
            </div>
            <IconButton
              icon={Bell}
              label="Data & model notices"
              onClick={() => setAlerts(true)}
            />
            <span className="avatar small">PL</span>
          </div>
        </header>
        <main className="workspace-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">UBE CHEMICALS / TSL PLANNING</div>
              <h1>
                {view === "executive"
                  ? "The business picture. In motion."
                  : view === "overview"
                    ? "A clearer view. A better plan."
                    : view === "lab"
                      ? "Explore the trade-offs."
                      : view === "timeline"
                        ? "Shape the plan, day by day."
                        : view === "logistics"
                          ? "A world of moving parts."
                          : view === "network"
                            ? "Every decision is connected."
                            : NAV.find((n) => n.id === view)?.name}
              </h1>
              <p>
                {view === "executive"
                  ? "Shared daily plan / material receipts, factory exposure and dispatch outcomes."
                  : view === "overview"
                    ? "Demand, materials and production. One connected planning horizon."
                    : view === "lab"
                      ? "Two-month optimizer prototype / same assumptions, three risk strategies."
                      : view === "timeline"
                        ? "Manual schedule / simulated orders / daily stock and delivery impacts."
                        : view === "logistics"
                          ? "Shared receipts and fulfilled factory dispatches / mock supply network."
                          : view === "network"
                            ? "Forecast signals, planning decisions and business outcomes."
                            : view === "runs"
                              ? "Local snapshots of your scenario experiments."
                              : "Monthly billing intelligence / model evidence and forecast uncertainty."}
              </p>
            </div>
            <div className="heading-actions">
              <div className="horizon-badge">
                <span className="tiny-dot" />
                <div>
                  <small>
                    {view === "executive" || view === "timeline" || view === "logistics" ? "DAILY MOCK HORIZON" : "OPTIMIZER HORIZON"}
                  </small>
                  <strong>
                    {view === "executive" || view === "timeline" || view === "logistics"
                      ? "Sep-Oct 2026 / +7d tail"
                      : result
                          ? `${period(result.horizon[0])} - ${period(result.horizon[result.horizon.length - 1])}`
                          : "2 months"}
                  </strong>
                </div>
              </div>
              <IconButton
                icon={RefreshCw}
                label="Refresh all data"
                disabled={busy}
                onClick={() => {
                  solve(request);
                  setRevision((n) => n + 1);
                }}
              />
              <IconButton
                icon={Maximize2}
                label="Toggle fullscreen"
                onClick={() => {
                  (document.fullscreenElement
                    ? document.exitFullscreen()
                    : document.documentElement.requestFullscreen()
                  ).catch(() =>
                    notify("Fullscreen unavailable in this browser."),
                  );
                }}
              />
              {view !== "timeline" &&
                view !== "logistics" &&
                view !== "executive" && (
                  <button
                    className="button dark"
                    onClick={download}
                    disabled={!result}
                  >
                    <Download size={16} />
                    <span>Export plan</span>
                  </button>
                )}
            </div>
          </div>
          <div className="context-strip">
            <span>
              <FlaskConical size={14} />
              <strong>Prototype workspace</strong>
            </span>
            <span>
              {view === "executive"
                ? standalone ? "Standalone executive sandbox: independent mock inputs, not the shared daily draft or an optimization run." : "Daily sandbox: shared with Gantt and logistics. Mock orders, stock and costs; not a monthly optimization run or live telemetry."
                : view === "timeline"
                  ? "Manual simulation / no OT. Default lag: 3 calendar days (provisional). Factory rule coverage is incomplete."
                  : view === "logistics"
                    ? standalone ? "Standalone logistics sandbox: independent mock shipments, not connected to the daily draft." : "Mock inbound arrivals feed the shared daily stock; outbound cargo comes only from fulfilled dispatch. Not live vessel tracking."
                    : "Optimizer: illustrative inputs. Daily reactor rules and no-OT policy not implemented."}
            </span>
            <button onClick={() => setAlerts(true)}>
              Review assumptions
              <ArrowUpRight size={13} />
            </button>
          </div>
          {(view === "executive" || view === "logistics") && <div className="shared-view-modes" role="group" aria-label="Operational view mode"><button aria-pressed={!standalone} onClick={() => setStandalone(false)}><Network size={15} />Shared daily scenario</button><button aria-pressed={standalone} onClick={() => setStandalone(true)}><FlaskConical size={15} />Standalone sandbox</button></div>}
          {(view === "timeline" || ((view === "executive" || view === "logistics") && !standalone)) && <ConnectedScenarioBar navigate={navigate} />}
          {standalone && (view === "executive" || view === "logistics") && <p className="linked-note">Standalone sandbox: independent inputs, not the shared daily draft. Switch back to Shared daily scenario to continue the connected plan.</p>}
          {error && (
            <div role="alert" className="error-banner">
              {view === "executive"
                ? "Monthly optimizer unavailable. Executive mock remains usable."
                : view === "logistics"
                  ? "Monthly optimizer unavailable. Logistics mock remains usable."
                  : error}
              <button onClick={() => solve(request)}>Retry</button>
            </div>
          )}
          {(view === "overview" || view === "lab") && (
            <div className={`metrics ${busy ? "refreshing" : ""}`}>
              <Metric
                label="Expected cost + modeled penalties"
                value={plan ? money(plan.expected_total_cost) : "--"}
                icon={Wallet}
                note={
                  plan
                    ? `${nf(Math.abs(costDelta), 1)}% ${costDelta >= 0 ? "lower" : "higher"} vs deterministic`
                    : "Waiting for planning engine"
                }
                tone={costDelta < 0 ? "orange" : "green"}
              />
              <Metric
                label="Expected service level"
                value={plan ? nf(plan.expected_service_level_pct, 2) : "--"}
                unit="%"
                icon={ShieldCheck}
                note={
                  plan
                    ? `Worst scenario: ${nf(plan.worst_service_level_pct, 2)}%`
                    : "No result available"
                }
                tone="blue"
              />
              <Metric
                label="Planned production"
                value={plan ? nf(production) : "--"}
                unit="t"
                icon={Factory}
                note={
                  plan
                    ? `${plan.product_plan.length} grades / 2-month horizon`
                    : "Monthly aggregate model"
                }
                tone="orange"
              />
              <Metric
                label="Expected shortage"
                value={plan ? nf(plan.expected_shortage_tons, 1) : "--"}
                unit="t"
                icon={Package}
                note={
                  plan
                    ? `${title(plan.mode)} strategy / demo inputs`
                    : "Not a factory execution plan"
                }
                tone={
                  plan && plan.expected_shortage_tons > 0 ? "orange" : "green"
                }
              />
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="overview-grid">
                <section className="surface demand-surface">
                  <Heading eyebrow="DEMAND SIGNAL" name="The next two months">
                    <select
                      aria-label="Demand grade"
                      value={grade}
                      onChange={(e) => setGrade(e.target.value)}
                      disabled={!grades.length}
                    >
                      {grades.length ? (
                        grades.map((g) => (
                          <option key={g.product_id}>{g.product_id}</option>
                        ))
                      ) : (
                        <option>No model connected</option>
                      )}
                    </select>
                  </Heading>
                  <div className="chart-headline">
                    <div>
                      <strong>
                        {forecast && !chartLoading
                          ? nf(forecast.total_forecast_tons)
                          : "--"}
                        <span> tonnes forecast</span>
                      </strong>
                      <small>
                        {forecast && !chartLoading
                          ? `${period(forecast.periods[0])} - ${period(forecast.periods[1])}`
                          : sourceLabel}
                      </small>
                    </div>
                    <div className="chart-legend">
                      <span>
                        <i className="legend-line actual" />
                        Actual
                      </span>
                      <span>
                        <i className="legend-line forecast" />
                        Forecast
                      </span>
                      <span>
                        <i className="legend-box" />
                        {forecast?.interval.level_pct || 80}% interval
                      </span>
                    </div>
                  </div>
                  <div className="demand-chart">
                    {chartLoading ? (
                      <div className="empty-chart">
                        <RefreshCw className="spin" size={24} />
                        <span>Loading demand intelligence</span>
                      </div>
                    ) : forecastError ? (
                      <div className="empty-chart">
                        <Activity size={28} />
                        <span>{forecastError}</span>
                        <button
                          className="button"
                          onClick={() => setRevision((r) => r + 1)}
                        >
                          <RefreshCw size={15} />
                          Retry
                        </button>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={chart}
                          margin={{ top: 12, right: 14, bottom: 0, left: -20 }}
                        >
                          <CartesianGrid
                            stroke="#e9eeeb"
                            vertical={false}
                            strokeDasharray="3 5"
                          />
                          <XAxis
                            dataKey="period"
                            tickFormatter={(v) => period(v).split(" ")[0]}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={25}
                            tick={{ fontSize: 11, fill: "#839087" }}
                            dy={8}
                          />
                          <YAxis
                            tickFormatter={(v) => nf(v)}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: "#839087" }}
                          />
                          <Tooltip
                            labelFormatter={(v) => period(String(v))}
                            formatter={(v: any, n: any) => [
                              Array.isArray(v)
                                ? `${nf(v[0])} - ${nf(v[1])} t`
                                : `${nf(Number(v))} t`,
                              n,
                            ]}
                            contentStyle={{
                              borderRadius: 6,
                              borderColor: "#e2e8e3",
                              fontSize: 12,
                            }}
                          />
                          <Area
                            type="linear"
                            dataKey="band"
                            name="Prediction interval"
                            fill="#cbe9dc"
                            stroke="none"
                            fillOpacity={0.7}
                          />
                          <Line
                            type="linear"
                            dataKey="actual"
                            name="Billing actual"
                            stroke="#1e3931"
                            strokeWidth={2.4}
                            dot={false}
                            activeDot={{ r: 5 }}
                          />
                          <Line
                            type="linear"
                            dataKey="forecast"
                            name="Forecast"
                            stroke="#149775"
                            strokeWidth={2.5}
                            strokeDasharray="5 4"
                            dot={{ r: 4, fill: "#fff", strokeWidth: 2 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div className="surface-footer">
                    <span
                      className={`source-badge ${forecastError ? "muted" : ""}`}
                    >
                      <span className="tiny-dot" />
                      {sourceLabel}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => navigate("forecast")}
                    >
                      Forecast detail
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="surface outlook">
                  <Heading
                    eyebrow="RAW MATERIAL SIGNAL"
                    name="Butadiene outlook"
                  >
                    <span className="label-chip amber">Demo prices</span>
                  </Heading>
                  <div className="price-summary">
                    <strong>
                      {priceChart[0]?.base
                        ? `$${nf(priceChart[0].base)}`
                        : "--"}
                      <span>/ tonne</span>
                    </strong>
                    <div className="price-direction">
                      <Waves size={18} />
                      FOB SEA Mid
                    </div>
                  </div>
                  <div className="price-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={priceChart}
                        margin={{ top: 15, right: 12, left: -12, bottom: 2 }}
                      >
                        <CartesianGrid stroke="#edf0ed" vertical={false} />
                        <XAxis
                          dataKey="period"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "#839087" }}
                        />
                        <YAxis
                          domain={["auto", "auto"]}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 10, fill: "#839087" }}
                          width={48}
                        />
                        <Tooltip
                          formatter={(v: any) =>
                            Array.isArray(v)
                              ? `$${nf(v[0])} - $${nf(v[1])}`
                              : `$${nf(Number(v))}`
                          }
                          contentStyle={{ borderRadius: 6, fontSize: 12 }}
                        />
                        <Area
                          dataKey="band"
                          name="Low / high scenarios"
                          fill="#dbedf1"
                          stroke="none"
                        />
                        <Line
                          dataKey="base"
                          name="Base price"
                          stroke="#478da5"
                          strokeWidth={2.4}
                          dot={{ r: 4, fill: "#fff" }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="price-range">
                    <div>
                      <small>LOW SCENARIO / M2</small>
                      <strong>${nf(priceChart[1]?.band[0] || 0)}</strong>
                    </div>
                    <div>
                      <small>HIGH SCENARIO / M2</small>
                      <strong>${nf(priceChart[1]?.band[1] || 0)}</strong>
                    </div>
                  </div>
                  <div className="surface-footer">
                    <span>Scenario range, not a prediction interval.</span>
                    <IconButton
                      icon={ArrowUpRight}
                      label="Raw material details"
                      onClick={() => setInspector("material")}
                    />
                  </div>
                </section>
              </div>
              <section className="flow-section">
                <Heading
                  eyebrow="THE CONNECTED PLAN"
                  name="From signal to decision"
                >
                  <button
                    className="text-button"
                    onClick={() => navigate("network")}
                  >
                    Open decision map
                    <ArrowUpRight size={15} />
                  </button>
                </Heading>
                {flow()}
              </section>
              <div className="bottom-grid">
                <section className="surface">
                  <Heading eyebrow="RISK & REWARD" name="Three ways to plan">
                    <span className="label-chip">Same demo inputs</span>
                  </Heading>
                  <div className="strategy-list">
                    {result?.strategy_comparison.map((s, i) => (
                      <button
                        className={`strategy-row ${result.selected_strategy === s.mode ? "selected" : ""}`}
                        key={s.mode}
                        disabled={busy}
                        onClick={() => {
                          const next = { ...request, strategy: s.mode };
                          setRequest(next);
                          solve(next);
                        }}
                      >
                        <span className="strategy-num">0{i + 1}</span>
                        <div>
                          <strong>{title(s.mode)}</strong>
                          <small>
                            {s.mode === "deterministic"
                              ? "Point forecast"
                              : s.mode === "stochastic"
                                ? "Expected scenarios"
                                : "Worst-case protection"}
                          </small>
                        </div>
                        <div className="strategy-cost">
                          <strong>{money(s.expected_total_cost)}</strong>
                          <small>
                            {nf(s.expected_service_level_pct, 2)}% service
                          </small>
                        </div>
                        <span className="strategy-check">
                          {result.selected_strategy === s.mode ? (
                            <Check size={16} />
                          ) : (
                            <ArrowUpRight size={16} />
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="surface-footer">
                    <span>Cost includes modeled penalties.</span>
                    <button
                      className="text-button"
                      onClick={() => navigate("lab")}
                    >
                      Scenario studio
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="surface">
                  <Heading eyebrow="GRADE ALLOCATION" name="Production mix">
                    <span className="label-chip">Tonnes</span>
                  </Heading>
                  <div className="mix-strip">
                    {plan?.product_plan.map((p, i) => (
                      <div
                        key={p.product}
                        title={`${p.product}: ${nf(p.planned_production_tons)} t`}
                        style={{
                          width: `${(p.planned_production_tons / production) * 100}%`,
                          background: COLORS[i % COLORS.length],
                        }}
                      />
                    ))}
                  </div>
                  <div className="grade-mix">
                    {plan?.product_plan.map((p, i) => (
                      <div key={p.product}>
                        <i style={{ background: COLORS[i % COLORS.length] }} />
                        <strong>{p.product}</strong>
                        <span>
                          {nf(p.planned_production_tons)}
                          <small> t</small>
                        </span>
                        <div className="mix-track">
                          <span
                            style={{
                              width: `${(p.planned_production_tons / Math.max(...plan.product_plan.map((x) => x.planned_production_tons))) * 100}%`,
                              background: COLORS[i % COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "lab" && <ObjectiveWeightsPanel weights={objectiveWeights} legacyMultiplier={request.shortage_penalty_multiplier} busy={busy} onChange={weights => setRequest(current => ({ ...current, objective_weights: weights }))} onRun={() => solve(request)} onReset={() => setRequest(current => ({ ...current, shortage_penalty_multiplier: 1, objective_weights: { ...DEFAULT_OBJECTIVE_WEIGHTS } }))} />}
          {view === "lab" && <OptimizationBeforeAfter reference={comparisonReference} current={result} pinned={pinned} dirty={dirty} onTogglePin={() => { referencePinned.current = !referencePinned.current; setPinned(referencePinned.current); }} onUseCurrent={() => { if (appliedResult.current) { setComparisonReference(appliedResult.current); referencePinned.current = true; setPinned(true); } }} />}
          <ObjectiveDecisionLab active={view === "lab"} applied={result} currentInput={request} dirty={dirty} busy={busy} onApply={data => { runId.current++; setBusy(false); acceptResult(data); setRequest(normalizeOptimizationRequest(data.input)); setError(""); notify("Tested plan and its frozen preferences applied. No daily re-scheduling performed."); }} />
          {view === "lab" && (
            <>
              <ObjectiveScorecard plan={plan} dirty={dirty} />
              <div className="lab-grid">
                <section className="surface control-surface">
                  <Heading
                    eyebrow="SCENARIO INPUTS"
                    name="Change the conditions"
                  >
                    <SlidersHorizontal size={18} />
                  </Heading>
                  <div className="presets">
                    <button onClick={() => preset("base")} disabled={busy}>
                      <RotateCcw size={14} />
                      Base
                    </button>
                    <button onClick={() => preset("demand")} disabled={busy}>
                      <TrendingUp size={14} />
                      Demand stress
                    </button>
                    <button onClick={() => preset("price")} disabled={busy}>
                      <Waves size={14} />
                      Price shock
                    </button>
                  </div>
                  <div className="controls">
                    {(
                      [
                        {
                          key: "demand_adjustment_pct",
                          label: "Demand change",
                          min: -20,
                          max: 30,
                          step: 1,
                          unit: "%",
                        },
                        {
                          key: "raw_price_adjustment_pct",
                          label: "Butadiene price",
                          min: -20,
                          max: 30,
                          step: 1,
                          unit: "%",
                        },
                        {
                          key: "capacity_adjustment_pct",
                          label: "Capacity change",
                          min: -15,
                          max: 15,
                          step: 1,
                          unit: "%",
                        },
                        {
                          key: "service_target_pct",
                          label: "Service target",
                          min: 85,
                          max: 99.5,
                          step: 0.5,
                          unit: "%",
                        },
                      ] as const
                    ).map((c) => (
                      <div className="slider-control" key={c.key}>
                        <div>
                          <label htmlFor={c.key}>{c.label}</label>
                          <strong>
                            {request[c.key] > 0 && c.min < 0 ? "+" : ""}
                            {request[c.key]}
                            {c.unit}
                          </strong>
                        </div>
                        <input
                          id={c.key}
                          type="range"
                          min={c.min}
                          max={c.max}
                          step={c.step}
                          value={request[c.key]}
                          onChange={(e) =>
                            update(c.key, Number(e.target.value))
                          }
                        />
                        <div className="range-labels">
                          <span>
                            {c.min}
                            {c.unit}
                          </span>
                          <span>
                            {c.max}
                            {c.unit}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    className="strategy-picker"
                    role="group"
                    aria-label="Planning strategy"
                  >
                    {(
                      [
                        "deterministic",
                        "stochastic",
                        "robust",
                      ] as OptimizationStrategy[]
                    ).map((s) => (
                      <button
                        aria-pressed={request.strategy === s}
                        className={request.strategy === s ? "chosen" : ""}
                        onClick={() =>
                          setRequest((r) => ({ ...r, strategy: s }))
                        }
                        key={s}
                      >
                        {title(s)}
                      </button>
                    ))}
                  </div>
                  <button
                    className="button green run-button"
                    disabled={busy || !validWeights}
                    onClick={() => solve(request)}
                  >
                    {busy ? (
                      <RefreshCw size={17} className="spin" />
                    ) : (
                      <Play size={17} />
                    )}
                    {busy ? "Solving scenarios" : "Run optimization"}
                  </button>
                  <div className="run-status">
                    <span className={`tiny-dot ${dirty ? "orange" : ""}`} />
                    {dirty
                      ? "Changes not applied"
                      : busy
                        ? "Planning engine running"
                        : "Results match current inputs"}
                  </div>
                </section>
                <section className="surface compare-surface">
                  <Heading
                    eyebrow="STRATEGY COMPARISON"
                    name="Cost meets resilience"
                  >
                    <div className="legend-inline">
                      <i style={{ background: "#14866d" }} />
                      Expected
                      <i style={{ background: "#d5ded9" }} />
                      Worst case
                    </div>
                  </Heading>
                  <div className="comparison-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={
                          result?.strategy_comparison.map((s) => ({
                            ...s,
                            name: title(s.mode),
                            expected: s.expected_total_cost / 1e6,
                            worst: s.worst_case_cost / 1e6,
                          })) || []
                        }
                        margin={{ top: 20, right: 5, left: -10, bottom: 4 }}
                      >
                        <CartesianGrid vertical={false} stroke="#e8eeea" />
                        <XAxis
                          dataKey="name"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 12, fill: "#617268" }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `$${v}M`}
                          tick={{ fontSize: 11, fill: "#839087" }}
                        />
                        <Tooltip
                          formatter={(v: any) => `$${nf(Number(v), 2)}M`}
                          contentStyle={{ borderRadius: 6, fontSize: 12 }}
                        />
                        <Bar
                          dataKey="expected"
                          name="Expected cost"
                          fill="#14866d"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={48}
                        />
                        <Bar
                          dataKey="worst"
                          name="Worst-scenario cost"
                          fill="#d5ded9"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={48}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Strategy</th>
                          <th>Expected service</th>
                          <th>Worst service</th>
                          <th>Shortage</th>
                          <th>Policy objective</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result?.strategy_comparison.map((s) => (
                          <tr key={s.mode}>
                            <td>
                              <span
                                className={`table-dot ${s.mode === result.selected_strategy ? "selected" : ""}`}
                              />
                              {title(s.mode)}
                            </td>
                            <td>{nf(s.expected_service_level_pct, 2)}%</td>
                            <td>{nf(s.worst_service_level_pct, 2)}%</td>
                            <td>{nf(s.expected_shortage_tons, 1)} t</td>
                            <td>{s.optimized_weighted_score === undefined ? "Re-run required" : nf(s.optimized_weighted_score, 1)}<small className="objective-term-kind">{s.mode === "deterministic" ? "Base case" : s.mode === "robust" ? "Worst case" : "Expected"}</small></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="surface-footer">
                    <span>
                      {busy
                        ? "Updating results..."
                        : dirty
                          ? "Showing last applied scenario"
                          : `Solver status: ${plan?.status || "--"}`}
                    </span>
                    <button
                      className="text-button"
                      onClick={save}
                      disabled={!result || busy || dirty}
                    >
                      <Save size={15} />
                      Save snapshot
                    </button>
                  </div>
                </section>
              </div>
              <div className="bottom-grid">
                <section className="surface">
                  <Heading eyebrow="COST ANATOMY" name="Unweighted cost & penalties">
                    <span className="label-chip">USD assumptions / not weighted</span>
                  </Heading>
                  <div className="cost-breakdown">
                    {plan &&
                      Object.entries(plan.cost_breakdown)
                        .filter(([, v]) => v > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([key, value], i) => (
                          <div key={key}>
                            <div>
                              <span>{title(key)}</span>
                              <strong>${nf(value)}</strong>
                            </div>
                            <div className="cost-track">
                              <span
                                style={{
                                  width: `${(value / Math.max(...Object.values(plan.cost_breakdown))) * 100}%`,
                                  background: COLORS[i % COLORS.length],
                                }}
                              />
                            </div>
                          </div>
                        ))}
                  </div>
                </section>
                <section className="surface">
                  <Heading
                    eyebrow="SCENARIO EXPOSURE"
                    name="What if reality changes?"
                  />
                  <div className="outcome-list">
                    {plan?.scenario_outcomes.map((s) => (
                      <div key={s.scenario}>
                        <div className="outcome-head">
                          <span className={`scenario-dot ${s.scenario}`} />
                          <strong>{s.label}</strong>
                          <span>{s.probability * 100}% weight</span>
                        </div>
                        <div className="outcome-metrics">
                          <div>
                            <small>Cost</small>
                            <strong>{money(s.total_cost)}</strong>
                          </div>
                          <div>
                            <small>Service</small>
                            <strong>{nf(s.service_level_pct, 2)}%</strong>
                          </div>
                          <div>
                            <small>Shortage</small>
                            <strong>{nf(s.shortage_tons)} t</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <section className="surface planning-table">
                <Heading
                  eyebrow="MONTHLY DECISIONS"
                  name="Your planning horizon"
                >
                  <span className="label-chip amber">
                    Aggregate plan / not daily scheduling
                  </span>
                </Heading>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Base demand</th>
                        <th>Production</th>
                        <th>RM purchase</th>
                        <th>RM ending stock</th>
                        <th>Prototype OT</th>
                        <th>Utilization</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan?.monthly_plan.map((m) => (
                        <tr key={m.period}>
                          <td>{period(m.period)}</td>
                          <td>{nf(m.base_demand_tons)} t</td>
                          <td>{nf(m.planned_production_tons)} t</td>
                          <td>{nf(m.raw_material_purchase_tons)} t</td>
                          <td>{nf(m.ending_raw_inventory_tons)} t</td>
                          <td className={m.overtime_tons ? "warning-text" : ""}>
                            {nf(m.overtime_tons)} t
                          </td>
                          <td>{nf(m.capacity_utilization_pct, 1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="surface planning-table">
                <Heading
                  eyebrow="PRODUCT DECISIONS"
                  name="Grade-level production & inventory"
                />
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Base demand</th>
                        <th>Production</th>
                        <th>Expected stock</th>
                        <th>Safety stock</th>
                        <th>Expected shortage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan?.product_plan.map((p, i) => (
                        <tr key={p.product}>
                          <td>
                            <i
                              className="table-dot"
                              style={{ background: COLORS[i % COLORS.length] }}
                            />
                            {p.product}
                          </td>
                          <td>{nf(p.base_demand_tons)} t</td>
                          <td>{nf(p.planned_production_tons)} t</td>
                          <td>{nf(p.expected_ending_inventory_tons, 1)} t</td>
                          <td>{nf(p.safety_stock_tons)} t</td>
                          <td
                            className={
                              p.expected_shortage_tons ? "warning-text" : ""
                            }
                          >
                            {nf(p.expected_shortage_tons, 1)} t
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {view === "forecast" && (
            <div className="legacy-panel">
              <DemandForecastPanel />
            </div>
          )}
          {view === "models" && (
            <>
              <div className="model-summary">
                <Metric
                  label="Pilot grades connected"
                  value={String(grades.length)}
                  icon={Activity}
                  note={
                    forecastError
                      ? "Forecast engine unavailable"
                      : "Billing forecast engine"
                  }
                />
                <Metric
                  label="Forecast horizon"
                  value="2"
                  unit="months"
                  icon={TrendingUp}
                  note="Overview forecast horizon"
                  tone="blue"
                />
                <Metric
                  label="Model evidence"
                  value="Backtest"
                  icon={ShieldCheck}
                  note="Individual grade metrics below"
                  tone="orange"
                />
              </div>
              {grades.length ? (
                <div className="legacy-panel">
                  <ModelPerformancePanel />
                </div>
              ) : (
                <section className="surface empty-state">
                  <Activity size={32} />
                  <h2>No model evidence available</h2>
                  <p>{forecastError || "Loading model catalogue..."}</p>
                  <button
                    className="button"
                    onClick={() => setRevision((r) => r + 1)}
                  >
                    <RefreshCw size={16} />
                    Refresh models
                  </button>
                </section>
              )}
            </>
          )}
          {view === "network" && (
            <>
              <section className="map-surface">
                <div className="map-header">
                  <span className="label-chip">
                    <Network size={13} />
                    PLANNING ARCHITECTURE
                  </span>
                  <span className="source-badge muted">
                    Conceptual map / not live telemetry
                  </span>
                </div>
                {flow(true)}
                <div className="feedback-line">
                  <RotateCcw size={15} />
                  <span>
                    Observed demand, realized cost and service feed the next
                    planning cycle
                  </span>
                </div>
              </section>
              <div className="bottom-grid">
                <section className="surface">
                  <Heading
                    eyebrow="PHYSICAL SYSTEM"
                    name="Reactor operating logic"
                  >
                    <span className="label-chip amber">Not yet in demo</span>
                  </Heading>
                  <div className="reactor-system">
                    <div className="reactor-pair">
                      <span className="pair-label">PRIMARY PAIR</span>
                      <div>
                        <div className="reactor">
                          <Waves size={26} />
                          <strong>RX1</strong>
                        </div>
                        <Plus size={16} />
                        <div className="reactor">
                          <Waves size={26} />
                          <strong>RX2</strong>
                        </div>
                      </div>
                      <span>BR production / up to 60 days</span>
                    </div>
                    <div className="reactor-pair">
                      <span className="pair-label">ALTERNATE PAIR</span>
                      <div>
                        <div className="reactor alternate">
                          <Waves size={26} />
                          <strong>RX3</strong>
                        </div>
                        <Plus size={16} />
                        <div className="reactor alternate">
                          <Waves size={26} />
                          <strong>RX4</strong>
                        </div>
                      </div>
                      <span>BR during primary-pair cleaning</span>
                    </div>
                  </div>
                  <div className="rule-tags">
                    <span>VCR: all 4 reactors</span>
                    <span>Cleaning: 7 days</span>
                    <span>No overlapping cleaning</span>
                    <span>VCR block: at least 8 days</span>
                    <span>No OT</span>
                  </div>
                </section>
                <section className="surface">
                  <Heading
                    eyebrow="INTEGRATION CHECKPOINTS"
                    name="What is connected?"
                  />
                  <div className="checkpoint-list">
                    {[
                      {
                        label: "Billing forecast endpoint",
                        value: forecastError
                          ? "Unavailable"
                          : grades.length
                            ? "Connected"
                            : "Loading",
                        okay: !!grades.length,
                      },
                      {
                        label: "Monthly optimizer API",
                        value: result ? "Connected / demo" : "Unavailable",
                        okay: !!result,
                      },
                      {
                        label: "Forecast to optimizer inputs",
                        value: "Not integrated",
                        okay: false,
                      },
                      {
                        label: "Daily grade & reactor constraints",
                        value: "Pending",
                        okay: false,
                      },
                      {
                        label: "No-OT company policy",
                        value: "Not implemented",
                        okay: false,
                      },
                      {
                        label: "ERP / factory execution",
                        value: "Not connected",
                        okay: false,
                      },
                    ].map((c) => (
                      <div key={c.label}>
                        <span>{c.label}</span>
                        <strong className={c.okay ? "green" : "warning-text"}>
                          {c.okay ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <Minus size={14} />
                          )}
                          {c.value}
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "network" && (
            <section className="allocation-section">
              <Heading
                eyebrow="THE PRODUCTION STREAM"
                name="One plan. Six destinations."
              >
                <span className="label-chip">
                  Demo allocation / {nf(production)} t
                </span>
              </Heading>
              <div className="allocation-chart">
                {plan ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    onResize={(width) => setAllocationWidth(width)}
                  >
                    <Sankey
                      data={allocation}
                      node={<AllocationNode />}
                      link={<AllocationLink />}
                      nodeWidth={8}
                      nodePadding={24}
                      margin={{
                        top: 20,
                        bottom: 20,
                        left: allocationWidth < 500 ? 85 : 135,
                        right: allocationWidth < 500 ? 90 : 115,
                      }}
                      iterations={32}
                      sort={false}
                    >
                      <Tooltip
                        formatter={(value: any) => `${nf(Number(value))} t`}
                      />
                    </Sankey>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-chart">
                    No allocation result available
                  </div>
                )}
              </div>
              <div className="allocation-note">
                Monthly production allocation from the current optimizer result.
                Not a daily reactor schedule.
              </div>
            </section>
          )}
          {view === "runs" && (
            <section className="surface">
              <Heading
                eyebrow="SCENARIO NOTEBOOK"
                name={`${saved.length} saved ${saved.length === 1 ? "plan" : "plans"}`}
              >
                <span className="label-chip">Browser-local storage</span>
              </Heading>
              {saved.length ? (
                <div className="saved-list">
                  {saved.map((run) => (
                    <div key={run.id}>
                      <span className="saved-icon">
                        <GitBranch size={19} />
                      </span>
                      <div>
                        <strong>{run.name}</strong>
                        <small>
                          {new Date(run.at).toLocaleString()} /{" "}
                          {run.result.horizon.map(period).join(" - ")}
                        </small>
                      </div>
                      <div className="saved-stat">
                        <strong>
                          {money(run.result.selected_plan.expected_total_cost)}
                        </strong>
                        <small>
                          {nf(
                            run.result.selected_plan.expected_service_level_pct,
                            2,
                          )}
                          % service
                        </small>
                      </div>
                      <button
                        className="button"
                        onClick={() => {
                          runId.current++;
                          setBusy(false);
                          acceptResult(run.result);
                          setRequest(run.result.input);
                          setError("");
                          navigate("lab");
                          notify(
                            "Saved result restored. No new solver run performed.",
                          );
                        }}
                      >
                        Open
                        <ArrowRight size={15} />
                      </button>
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${run.name}`}
                        onClick={() =>
                          setSaved((prev) =>
                            prev.filter((r) => r.id !== run.id),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <GitBranch size={34} />
                  <h2>Your next decision starts here.</h2>
                  <p>No saved scenarios yet.</p>
                  <button
                    className="button green"
                    onClick={() => navigate("lab")}
                  >
                    <FlaskConical size={16} />
                    Open scenario studio
                  </button>
                </div>
              )}
            </section>
          )}
          <ManualPlanStudio source={null} active={view === "timeline"} />
          <ConnectedLogistics active={view === "logistics" && !standalone} />
          <ConnectedCockpit active={view === "executive" && !standalone} navigate={navigate} />
          <LogisticsGlobeStudio active={view === "logistics" && standalone} />
          <ExecutiveCockpit
            active={view === "executive" && standalone}
            onNavigate={navigate}
          />
          <footer className="workspace-footer">
            <span>
              <span className="tiny-dot" />
              ONE PLATFORM. ONE DATA. ONE PLAN.
            </span>
            <span>
              UBE / Research workspace<span className="footer-divider">|</span>
              Not approved for production execution
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            title="Dismiss notification"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {searchOpen && (
        <div className="modal-backdrop" onClick={() => setSearchOpen(false)}>
          <div
            className="search-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Search workspace"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="search-input">
              <Search size={21} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a view or product grade..."
                aria-label="Search views and grades"
              />
              <IconButton
                icon={X}
                label="Close search"
                onClick={() => setSearchOpen(false)}
              />
            </div>
            <div className="search-results">
              <div className="eyebrow">WORKSPACE</div>
              {matching.map((n) => (
                <button key={n.id} onClick={() => navigate(n.id)}>
                  <n.icon size={18} />
                  <span>{n.name}</span>
                  <ArrowRight size={16} />
                </button>
              ))}
              {matchingGrades.length > 0 && (
                <div className="eyebrow">PRODUCT GRADES</div>
              )}
              {matchingGrades.map((g) => (
                <button
                  key={g.product_id}
                  onClick={() => {
                    setGrade(g.product_id);
                    navigate("overview");
                  }}
                >
                  <Package size={18} />
                  <span>{g.product_id}</span>
                  <ArrowRight size={16} />
                </button>
              ))}
              {!matching.length && !matchingGrades.length && (
                <p>No matching views or grades.</p>
              )}
            </div>
          </div>
        </div>
      )}
      {(currentNode || alerts) && (
        <div
          className="drawer-backdrop"
          onClick={() => {
            setInspector(null);
            setAlerts(false);
          }}
        >
          <aside
            className="inspector"
            role="dialog"
            aria-modal="true"
            aria-label={
              alerts ? "Data and prototype notices" : currentNode?.detail
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inspector-top">
              <span className="eyebrow">
                {alerts ? "WORKSPACE STATUS" : "DECISION INSPECTOR"}
              </span>
              <IconButton
                icon={X}
                label="Close inspector"
                onClick={() => {
                  setInspector(null);
                  setAlerts(false);
                }}
              />
            </div>
            {alerts ? (
              <>
                <Bell className="inspector-hero-icon" size={30} />
                <h2>Know what is real.</h2>
                <p className="inspector-subtitle">
                  Data provenance and model readiness
                </p>
                <div className="notice">
                  <strong>Billing demand forecast</strong>
                  <p>
                    {sourceLabel}. Forecast horizon is separate from the
                    optimizer demo horizon. Latest extract-month completeness is
                    unverified.
                  </p>
                </div>
                <div className="notice warning">
                  <strong>Optimizer assumptions</strong>
                  <p>
                    Monthly prototype. Costs, BOM, capacity and stock targets
                    are illustrative. OT is still in the model despite company
                    no-OT policy.
                  </p>
                </div>
                <div className="notice">
                  <strong>Pending factory constraints</strong>
                  <p>
                    Grade transitions, reactor age, cleaning, minimum continuous
                    runs and holiday restrictions need the detailed scheduling
                    model.
                  </p>
                </div>
                <div className="notice">
                  <strong>Saved plans</strong>
                  <p>
                    Stored only in this browser, not synchronized to ERP or the
                    server.
                  </p>
                </div>
                <button
                  className="button green"
                  onClick={() => {
                    setAlerts(false);
                    navigate("network");
                  }}
                >
                  Integration map
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              currentNode && (
                <>
                  <currentNode.icon
                    className={`inspector-hero-icon ${currentNode.accent}`}
                    size={32}
                  />
                  <h2>{currentNode.detail}</h2>
                  <p className="inspector-subtitle">{currentNode.caption}</p>
                  <div className="inspector-facts">
                    {currentNode.items.map((item, i) => (
                      <div key={item}>
                        <span>0{i + 1}</span>
                        <p>{item}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    className="button green"
                    onClick={() => {
                      setInspector(null);
                      navigate(
                        currentNode.id === "demand" ? "forecast" : "lab",
                      );
                    }}
                  >
                    Open{" "}
                    {currentNode.id === "demand"
                      ? "forecast"
                      : "scenario studio"}
                    <ArrowRight size={16} />
                  </button>
                </>
              )
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
