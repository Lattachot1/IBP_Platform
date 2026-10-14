import { DEFAULT_ASSUMPTIONS, evaluatePlan, makeDraft } from "./manualPlanning";
import type {
  ManualPlan,
  PlanAssumptions,
  PlanEvaluation,
  Pair,
} from "./manualPlanning";

export type ExecutiveShock = {
  demandPct: number;
  pricePct: number;
  receiptDelay: number;
};
export type ExecutiveOption = {
  id: "hold" | "expedite" | "reschedule";
  name: string;
  condition: string;
  plan: ManualPlan;
  evaluation: PlanEvaluation;
  interventionCost: number;
  costExcludingPenalty: number;
};
export const SHOCK_PRESETS = [
  {
    id: "normal",
    name: "Base conditions",
    detail: "Original mock assumptions",
    shock: { demandPct: 0, pricePct: 0, receiptDelay: 0 },
  },
  {
    id: "price",
    name: "BD price jump",
    detail: "+25% purchasing price",
    shock: { demandPct: 0, pricePct: 25, receiptDelay: 0 },
  },
  {
    id: "rush",
    name: "Demand surge",
    detail: "+20% delivery requirements",
    shock: { demandPct: 20, pricePct: 0, receiptDelay: 0 },
  },
  {
    id: "delay",
    name: "Material arrives late",
    detail: "+7 days on every receipt",
    shock: { demandPct: 0, pricePct: 0, receiptDelay: 7 },
  },
  {
    id: "combined",
    name: "Combined disruption",
    detail: "+15% demand / +20% price / +5d receipts",
    shock: { demandPct: 15, pricePct: 20, receiptDelay: 5 },
  },
] as const;

export function executiveBase() {
  const plan = makeDraft(null);
  // Equal seven-day evaluation tail prevents delivery extensions from hiding unmet demand.
  plan.days += 7;
  // Standalone demo: divide monthly purchases into three receipts, not a procurement solution.
  plan.purchases = plan.purchases.flatMap((p) =>
    [0, 10, 20].map((offset, i) => ({
      ...p,
      id: `${p.id}-${i}`,
      start: p.start + offset,
      tons: p.tons / 3,
    })),
  );
  plan.cleanings = [
    { id: "demo-clean-primary", pair: "RX1+RX2", start: 33, duration: 7 },
    { id: "demo-clean-secondary", pair: "RX3+RX4", start: 57, duration: 7 },
  ];
  const assumptions: PlanAssumptions = {
    ...DEFAULT_ASSUMPTIONS,
    initialStock: { ...DEFAULT_ASSUMPTIONS.initialStock },
    monthlyPrices: { ...DEFAULT_ASSUMPTIONS.monthlyPrices },
    holidays: [],
  };
  return { plan, assumptions, evaluation: evaluatePlan(plan, assumptions) };
}
export function buildExecutiveExperiment(shock: ExecutiveShock) {
  const baseline = executiveBase();
  const assumptions: PlanAssumptions = {
    ...baseline.assumptions,
    demandChange: shock.demandPct,
    monthlyPrices: Object.fromEntries(
      Object.entries(baseline.assumptions.monthlyPrices).map(([m, p]) => [
        m,
        p * (1 + shock.pricePct / 100),
      ]),
    ),
  };
  const delayed = {
    ...baseline.plan,
    purchases: baseline.plan.purchases.map((p) => ({
      ...p,
      start: p.start + shock.receiptDelay,
    })),
  };
  const options: ExecutiveOption[] = [
    {
      id: "hold",
      name: "Keep the current schedule",
      condition: "No intervention. Receipts follow the selected delay.",
      plan: delayed,
      interventionCost: 0,
      evaluation: evaluatePlan(delayed, assumptions),
      costExcludingPenalty: 0,
    },
    {
      id: "expedite",
      name: "Restore receipt dates",
      condition:
        "Assumes supplier can restore every original receipt date. Mock premium: USD 35/t when delay > 0.",
      plan: baseline.plan,
      interventionCost:
        shock.receiptDelay > 0
          ? baseline.plan.purchases.reduce((s, p) => s + p.tons, 0) * 35
          : 0,
      evaluation: evaluatePlan(baseline.plan, assumptions),
      costExcludingPenalty: 0,
    },
    {
      id: "reschedule",
      name: "Agree delivery extensions",
      condition:
        "Assumes every customer accepts +7 days. Mock agreement cost: USD 50,000. Demand quantity unchanged.",
      plan: {
        ...delayed,
        deliveries: delayed.deliveries.map((d) => ({
          ...d,
          start: d.start + 7,
        })),
      },
      interventionCost: 50000,
      evaluation: evaluatePlan(
        {
          ...delayed,
          deliveries: delayed.deliveries.map((d) => ({
            ...d,
            start: d.start + 7,
          })),
        },
        assumptions,
      ),
      costExcludingPenalty: 0,
    },
  ].map((option) => ({
    ...option,
    costExcludingPenalty:
      option.evaluation.cost -
      option.evaluation.costBreakdown.shortagePenalty +
      option.interventionCost,
  })) as ExecutiveOption[];
  const cashLikeBase =
    baseline.evaluation.cost -
    baseline.evaluation.costBreakdown.shortagePenalty;
  return { baseline, assumptions, options, cashLikeBase };
}
export type ReactorStatus =
  | "Producing"
  | "Cleaning"
  | "Standby"
  | "Material hold";
export type ReactorState = {
  id: string;
  pair: Pair;
  status: ReactorStatus;
  age: number;
};
export function reactorSnapshot(
  plan: ManualPlan,
  result: PlanEvaluation,
  day: number,
): ReactorState[] {
  const active = plan.campaigns.filter(
    (c) => day >= c.start && day < c.start + c.duration,
  );
  const grade = active.length === 1 ? active[0].grade : null;
  const clean = (pair: Pair) =>
    plan.cleanings.some(
      (c) => c.pair === pair && day >= c.start && day < c.start + c.duration,
    );
  const rawHold =
    !!grade &&
    result.daily[day]?.produced === 0 &&
    !clean("RX1+RX2") &&
    !clean("RX3+RX4");
  const producing = !!grade && result.daily[day]?.produced > 0;
  return ["RX1", "RX2", "RX3", "RX4"].map((id, i) => {
    const pair = i < 2 ? "RX1+RX2" : "RX3+RX4";
    const running =
      producing &&
      (grade!.startsWith("VCR") || (clean("RX1+RX2") ? i >= 2 : i < 2));
    return {
      id,
      pair,
      status: clean(pair)
        ? "Cleaning"
        : running
          ? "Producing"
          : rawHold
            ? "Material hold"
            : "Standby",
      age:
        i < 2 ? result.daily[day]?.age12 || 0 : result.daily[day]?.age34 || 0,
    };
  });
}
export function cashComponents(option: ExecutiveOption) {
  const c = option.evaluation.costBreakdown;
  return [
    { name: "Raw material purchases", value: c.purchases, color: "#398f8e" },
    { name: "Production", value: c.production, color: "#86a254" },
    { name: "Campaign setups", value: c.setups, color: "#b18a5a" },
    {
      name: "Inventory holding",
      value: c.fgHolding + c.rawHolding,
      color: "#8385a6",
    },
    {
      name: "Mock intervention",
      value: option.interventionCost,
      color: "#d18668",
    },
  ];
}
