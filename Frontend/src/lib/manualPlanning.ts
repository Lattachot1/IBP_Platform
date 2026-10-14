import type { OptimizationDemoResponse } from "./optimizationApi";

export const GRADE_RULES = [
  {
    id: "BR150",
    capacity: 230,
    minRun: 2,
    stock: 330,
    bom: 1.02,
    demand: [1700, 1650],
  },
  {
    id: "BR150L",
    capacity: 220,
    minRun: 5,
    stock: 280,
    bom: 1.03,
    demand: [1450, 1500],
  },
  {
    id: "BR150B",
    capacity: 239,
    minRun: 4,
    stock: 210,
    bom: 1.02,
    demand: [1050, 1100],
  },
  {
    id: "BR360B",
    capacity: 230,
    minRun: 1,
    stock: 60,
    bom: 1.03,
    demand: [250, 220],
  },
  {
    id: "VCR412",
    capacity: 230,
    minRun: 2,
    stock: 120,
    bom: 1.04,
    demand: [550, 600],
  },
  {
    id: "VCR617",
    capacity: 220,
    minRun: 2,
    stock: 220,
    bom: 1.04,
    demand: [1150, 1100],
  },
] as const;
export type Grade = (typeof GRADE_RULES)[number]["id"];
export type Pair = "RX1+RX2" | "RX3+RX4";
export interface Campaign {
  id: string;
  grade: Grade;
  start: number;
  duration: number;
}
export interface Purchase {
  id: string;
  start: number;
  tons: number;
  price: number | null;
}
export interface Cleaning {
  id: string;
  pair: Pair;
  start: number;
  duration: number;
}
export interface Delivery {
  id: string;
  grade: Grade;
  start: number;
  tons: number;
}
export interface ManualPlan {
  startDate: string;
  days: number;
  campaigns: Campaign[];
  purchases: Purchase[];
  cleanings: Cleaning[];
  deliveries: Delivery[];
}
export interface PlanAssumptions {
  lag: number;
  initialStock: Record<Grade, number>;
  initialRaw: number;
  rawCapacity: number;
  demandChange: number;
  rawHoldingDaily: number;
  fgHoldingDaily: number;
  shortagePenalty: number;
  productionCost: number;
  setupCost: number;
  age12: number;
  age34: number;
  holidays: string[];
  monthlyPrices: Record<string, number>;
}
export interface PlanIssue {
  code: string;
  day: number;
  text: string;
  severity: "conflict" | "warning";
}
export interface DailyBalance {
  day: number;
  date: string;
  produced: number;
  delivered: number;
  demand: number;
  shortage: number;
  fg: number;
  raw: number;
  rawUsed: number;
  stock: Record<Grade, number>;
  gradeShortage: Record<Grade, number>;
  age12: number;
  age34: number;
}
export interface PlanEvaluation {
  daily: DailyBalance[];
  issues: PlanIssue[];
  totalProduced: number;
  totalDemand: number;
  totalDelivered: number;
  totalShortage: number;
  service: number;
  endingFG: number;
  minRaw: number;
  changeovers: number;
  transitionLoss: number;
  unfinishedWip: number;
  cost: number;
  costBreakdown: Record<string, number>;
}
export const DEFAULT_ASSUMPTIONS: PlanAssumptions = {
  lag: 3,
  initialStock: Object.fromEntries(
    GRADE_RULES.map((g) => [g.id, g.stock]),
  ) as Record<Grade, number>,
  initialRaw: 1100,
  rawCapacity: 5000,
  demandChange: 0,
  rawHoldingDaily: 8 / 30,
  fgHoldingDaily: 14 / 30,
  shortagePenalty: 9000,
  productionCost: 160,
  setupCost: 9000,
  age12: 0,
  age34: 0,
  holidays: [],
  monthlyPrices: { "2026-09": 1503.75, "2026-10": 1401.5 },
};
const MS_DAY = 86400000;
export const dateAt = (start: string, day: number) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + day * MS_DAY)
    .toISOString()
    .slice(0, 10);
export const dayAt = (start: string, date: string) =>
  Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      MS_DAY,
  );
export const isWeekend = (date: string) =>
  [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const rule = (grade: Grade) => GRADE_RULES.find((g) => g.id === grade)!;
const emptyGrades = () =>
  Object.fromEntries(GRADE_RULES.map((g) => [g.id, 0])) as Record<
    Grade,
    number
  >;
const vcr = (grade: Grade) => grade.startsWith("VCR");
const LEGACY_TRANSITIONS = new Set([
  "BR150>BR150L",
  "BR150>BR150B",
  "BR150>VCR412",
  "BR150L>BR150",
  "BR150B>BR150",
  "BR150B>BR360B",
  "BR360B>BR150",
  "VCR412>BR150",
  "VCR412>VCR617",
  "VCR617>BR150",
]);

export function makeDraft(source: OptimizationDemoResponse | null): ManualPlan {
  const months = source?.horizon || ["2026-09", "2026-10"];
  const startDate = `${months[0]}-01`;
  const [year, month] = months[months.length - 1].split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const days = dayAt(startDate, end);
  // Monthly quantities do not contain daily sequencing; this is a draft, not solver scheduling.
  const order: Grade[] = [
    "BR150L",
    "BR150",
    "BR150B",
    "BR360B",
    "VCR412",
    "VCR617",
  ];
  let cursor = 0;
  const campaigns = order.map((grade, i) => {
    const product = source?.selected_plan.product_plan.find(
      (p) => p.product === grade,
    );
    const target =
      product?.planned_production_tons ??
      rule(grade).demand.reduce((s, v) => s + v, 0);
    const duration = Math.max(
      rule(grade).minRun,
      Math.ceil(target / rule(grade).capacity),
    );
    const block = { id: `campaign-${i}`, grade, start: cursor, duration };
    cursor += duration;
    return block;
  });
  const purchases = months.map((m, i) => ({
    id: `purchase-${i}`,
    start: dayAt(startDate, `${m}-01`),
    tons:
      source?.selected_plan.monthly_plan[i]?.raw_material_purchase_tons || 6000,
    price: null,
  }));
  const deliveries: Delivery[] = [];
  months.forEach((m, i) => {
    const [y, mm] = m.split("-").map(Number);
    const count = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    const offset = dayAt(startDate, `${m}-01`);
    for (const grade of GRADE_RULES) {
      const tons =
        grade.demand[i % 2] *
        (1 + (source?.input.demand_adjustment_pct || 0) / 100);
      // Spread monthly demand into weekly due dates; no actual orders are implied.
      const dueDays = [6, 13, 20, count - 1];
      dueDays.forEach((due, k) =>
        deliveries.push({
          id: `delivery-${grade.id}-${i}-${k}`,
          grade: grade.id,
          start: offset + due,
          tons: tons / dueDays.length,
        }),
      );
    }
  });
  return { startDate, days, campaigns, purchases, cleanings: [], deliveries };
}

export function evaluatePlan(
  plan: ManualPlan,
  assumptions: PlanAssumptions,
): PlanEvaluation {
  const issues: PlanIssue[] = [];
  const add = (
    code: string,
    day: number,
    text: string,
    severity: PlanIssue["severity"] = "conflict",
  ) => issues.push({ code, day, text, severity });
  const activeByDay: Campaign[][] = Array.from({ length: plan.days }, () => []);
  for (const c of plan.campaigns) {
    if (
      !Number.isInteger(c.start) ||
      !Number.isInteger(c.duration) ||
      c.duration < 1 ||
      c.start < 0 ||
      c.start + c.duration > plan.days
    )
      add(
        "horizon",
        Math.max(0, c.start),
        `${c.grade}: campaign crosses the planning horizon`,
      );
    for (
      let d = Math.max(0, c.start);
      d < Math.min(plan.days, c.start + c.duration);
      d++
    )
      activeByDay[d].push(c);
  }
  for (const c of plan.cleanings) {
    if (c.duration !== 7)
      add("cleaning-length", c.start, `${c.pair}: cleaning must last 7 days`);
    if (c.start < 0 || c.start + c.duration > plan.days)
      add(
        "cleaning-horizon",
        Math.max(c.start, 0),
        `${c.pair}: cleaning crosses the horizon`,
      );
  }
  for (const item of [...plan.purchases, ...plan.deliveries])
    if (item.start < 0 || item.start >= plan.days)
      add(
        "event-horizon",
        Math.max(0, item.start),
        "An arrival or delivery is outside the horizon",
      );
  // Full-day overlap has no defensible product allocation: do not invent output.
  activeByDay.forEach((blocks, day) => {
    if (blocks.length > 1)
      add(
        "overlap",
        day,
        `${blocks.map((b) => b.grade).join(" + ")}: overlapping full-day campaigns; output not credited`,
      );
  });
  const dailyGrade = activeByDay.map((blocks) =>
    blocks.length === 1 ? blocks[0].grade : null,
  );
  let campaignRuns = 0;
  for (let d = 0; d < plan.days; ) {
    const grade = dailyGrade[d];
    if (!grade) {
      d++;
      continue;
    }
    campaignRuns++;
    let end = d + 1;
    while (end < plan.days && dailyGrade[end] === grade) end++;
    if (end - d < rule(grade).minRun)
      add(
        "min-run",
        d,
        `${grade}: ${end - d} consecutive days; minimum ${rule(grade).minRun}`,
      );
    d = end;
  }
  for (let d = 0; d < plan.days; ) {
    if (!dailyGrade[d] || !vcr(dailyGrade[d]!)) {
      d++;
      continue;
    }
    let end = d + 1;
    while (end < plan.days && dailyGrade[end] && vcr(dailyGrade[end]!)) end++;
    if (end - d < 8)
      add("vcr-block", d, `VCR block lasts ${end - d} days; minimum 8`);
    if (
      end < plan.days &&
      !plan.cleanings.some(
        (c) => c.pair === "RX3+RX4" && c.start === end && c.duration === 7,
      )
    )
      add(
        "post-vcr-cleaning",
        end,
        "RX3+RX4 cleaning must start after the VCR block",
      );
    d = end;
  }
  const stocks = { ...assumptions.initialStock };
  const maturity: Record<Grade, number>[] = Array.from(
    { length: plan.days + assumptions.lag + 1 },
    emptyGrades,
  );
  let raw = assumptions.initialRaw;
  let age12 = assumptions.age12,
    age34 = assumptions.age34;
  let previousGrade: Grade | null = null;
  let totalProduced = 0,
    totalDemand = 0,
    totalDelivered = 0,
    totalShortage = 0,
    minRaw = raw,
    changeovers = 0,
    transitionLoss = 0,
    purchaseCost = 0,
    fgHolding = 0,
    rawHolding = 0;
  const daily: DailyBalance[] = [];
  for (let day = 0; day < plan.days; day++) {
    const date = dateAt(plan.startDate, day);
    const cleaning12 = plan.cleanings.filter(
      (c) =>
        c.pair === "RX1+RX2" && day >= c.start && day < c.start + c.duration,
    );
    const cleaning34 = plan.cleanings.filter(
      (c) =>
        c.pair === "RX3+RX4" && day >= c.start && day < c.start + c.duration,
    );
    if (cleaning12.length && cleaning34.length)
      add(
        "cleaning-overlap",
        day,
        "Both reactor pairs are cleaning simultaneously",
      );
    if (cleaning12.length > 1 || cleaning34.length > 1)
      add(
        "duplicate-cleaning",
        day,
        "Cleaning windows overlap on the same pair",
      );
    if (
      plan.cleanings.some(
        (c) =>
          c.pair === "RX1+RX2" &&
          c.start + c.duration === day &&
          c.duration === 7,
      )
    )
      age12 = 0;
    if (
      plan.cleanings.some(
        (c) =>
          c.pair === "RX3+RX4" &&
          c.start + c.duration === day &&
          c.duration === 7,
      )
    )
      age34 = 0;
    const arrivals = plan.purchases.filter((p) => p.start === day);
    arrivals.forEach((p) => {
      raw += p.tons;
      purchaseCost +=
        p.tons *
        (p.price ?? assumptions.monthlyPrices[date.slice(0, 7)] ?? 1500);
    });
    if (raw > assumptions.rawCapacity + 1e-6)
      add(
        "raw-storage",
        day,
        `RM stock ${Math.round(raw)} t exceeds ${assumptions.rawCapacity} t storage`,
      );
    const grade = dailyGrade[day];
    if (
      day > 0 &&
      dailyGrade[day - 1] &&
      vcr(dailyGrade[day - 1]!) &&
      (!grade || !vcr(grade)) &&
      age12 >= 50
    )
      add(
        "post-vcr-age",
        day,
        "Primary reactor age must be below 50 days after VCR",
      );
    let produced = 0,
      rawUsed = 0;
    if (grade) {
      const changed = previousGrade !== null && previousGrade !== grade;
      let capacity: number = rule(grade).capacity;
      if (changed) {
        changeovers++;
        const key = `${previousGrade}>${grade}`;
        if (!LEGACY_TRANSITIONS.has(key))
          add(
            "transition",
            day,
            `${key}: not in legacy transition table; confirm Allow_GradeChange.xlsx`,
            "warning",
          );
        if (
          [
            "BR150>BR150B",
            "BR150>BR150L",
            "BR150B>BR150",
            "BR150L>BR150",
          ].includes(key)
        )
          capacity -= 5;
        const transitionTotals: Record<string, number> = {
          "BR150>VCR412": 200,
          "VCR412>VCR617": 190,
          "VCR617>BR150": 95,
        };
        if (transitionTotals[key] !== undefined) {
          capacity = transitionTotals[key];
          add(
            "transition-allocation",
            day,
            `${key}: transition total assigned to incoming grade for this simulation; split unverified`,
            "warning",
          );
        }
        transitionLoss += rule(grade).capacity - capacity;
        if (
          vcr(previousGrade!) &&
          grade === "BR150" &&
          (isWeekend(date) || assumptions.holidays.includes(date))
        )
          add(
            "holiday-change",
            day,
            "VCR to BR150 changeover is forbidden on weekends/company holidays",
          );
      }
      const unavailable = vcr(grade)
        ? !!(cleaning12.length || cleaning34.length)
        : !!(cleaning12.length && cleaning34.length);
      if (unavailable)
        add(
          "reactor-unavailable",
          day,
          `${grade}: required reactor capacity is cleaning; output not credited`,
        );
      else {
        const required = capacity * rule(grade).bom;
        if (raw + 1e-6 < required)
          add(
            "raw-shortage",
            day,
            `${grade}: needs ${Math.round(required)} t RM, only ${Math.round(raw)} t available; output not credited`,
          );
        else {
          if (
            vcr(grade) &&
            (day === 0 || !dailyGrade[day - 1] || !vcr(dailyGrade[day - 1]!)) &&
            age34 > 15
          )
            add(
              "vcr-age",
              day,
              `RX3+RX4 age ${age34} days exceeds 15 before VCR`,
            );
          if (vcr(grade) || !cleaning12.length) age12++;
          if (vcr(grade) || cleaning12.length) age34++;
          if (age12 > 60 && (vcr(grade) || !cleaning12.length))
            add("reactor-age", day, `RX1+RX2 age ${age12} exceeds 60 days`);
          produced = capacity;
          rawUsed = required;
          raw -= rawUsed;
          // Lag is in calendar days; product is available before that day's deliveries.
          maturity[day + assumptions.lag][grade] += produced;
        }
      }
      previousGrade = grade;
    }
    if (raw < -1e-6)
      add(
        "raw-shortage",
        day,
        `RM deficit ${Math.round(-raw)} t: requested production is unfunded by material stock`,
      );
    minRaw = Math.min(minRaw, raw);
    GRADE_RULES.forEach((g) => (stocks[g.id] += maturity[day][g.id]));
    const shortages = emptyGrades();
    let delivered = 0,
      demand = 0,
      shortage = 0;
    const dueByGrade = emptyGrades();
    plan.deliveries
      .filter((o) => o.start === day)
      .forEach(
        (o) =>
          (dueByGrade[o.grade] +=
            o.tons * (1 + assumptions.demandChange / 100)),
      );
    GRADE_RULES.forEach((g) => {
      const due = dueByGrade[g.id];
      const sent = Math.min(stocks[g.id], due);
      stocks[g.id] -= sent;
      shortages[g.id] = due - sent;
      delivered += sent;
      demand += due;
      shortage += due - sent;
    });
    const fg = Object.values(stocks).reduce((s, n) => s + n, 0);
    fgHolding += fg * assumptions.fgHoldingDaily;
    rawHolding += Math.max(0, raw) * assumptions.rawHoldingDaily;
    totalProduced += produced;
    totalDemand += demand;
    totalDelivered += delivered;
    totalShortage += shortage;
    daily.push({
      day,
      date,
      produced,
      delivered,
      demand,
      shortage,
      fg,
      raw,
      rawUsed,
      stock: { ...stocks },
      gradeShortage: shortages,
      age12,
      age34,
    });
  }
  const unfinishedWip = maturity
    .slice(plan.days)
    .reduce((s, row) => s + Object.values(row).reduce((a, b) => a + b, 0), 0);
  const costBreakdown = {
    purchases: purchaseCost,
    production: totalProduced * assumptions.productionCost,
    setups: campaignRuns * assumptions.setupCost,
    fgHolding,
    rawHolding,
    shortagePenalty: totalShortage * assumptions.shortagePenalty,
  };
  return {
    daily,
    issues,
    totalProduced,
    totalDemand,
    totalDelivered,
    totalShortage,
    service: totalDemand > 0 ? (totalDelivered / totalDemand) * 100 : 100,
    endingFG: daily[daily.length - 1]?.fg || 0,
    minRaw,
    changeovers,
    transitionLoss,
    unfinishedWip,
    cost: Object.values(costBreakdown).reduce((s, n) => s + n, 0),
    costBreakdown,
  };
}
