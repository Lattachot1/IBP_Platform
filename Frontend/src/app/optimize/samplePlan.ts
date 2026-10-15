// Types + offline sample for the /optimize page.
//
// The shapes mirror POST /api/v1/optimize (Backend/optimization/) one to
// one. SAMPLE_PLAN is the same 28-day plan the backend stub returns; it
// is the offline fallback when the backend is unreachable, so the page
// renders standalone.

export interface GradeMeta {
  id: string;
  disp: string;
  slot: number;
}

export interface DayPart {
  grade: string;
  tons: number;
}

export type PairStatus = 'prod' | 'clean' | 'idle';

export interface ReactorCell {
  id: string;
  status: PairStatus;
  parts: DayPart[];
}

export interface PlanDay {
  iso: string;
  date: string;
  wd: string;
  wknd: boolean;
  chg: boolean;
  cap: number | null;
  parts: DayPart[];
  p1: PairStatus;
  p2: PairStatus;
  reactors: ReactorCell[];
  rx: string;
  note: string;
}

export interface CheckItem {
  level: 'ok' | 'warn';
  text: string;
}

export interface Kpis {
  status: string;
  total_tons: number;
  fulfillment_pct: number;
  shortage_tons: number;
  changeover_days: number;
  solve_s: number;
}

export interface FulfillRow {
  grade: string;
  disp: string;
  slot: number;
  produced: number;
  demand: number;
  shortage: number;
}

export interface OptimizeResult {
  status: string;
  mode: string;
  solve_s: number;
  horizon_days: number;
  start_date: string;
  grades: GradeMeta[];
  demand_used: Record<string, number>;
  kpis: Kpis;
  fulfillment: FulfillRow[];
  days: PlanDay[];
  pair_notes: Record<string, string>;
  checks: CheckItem[];
  assumptions: string[];
}

export const GRADES: GradeMeta[] = [
  { id: 'BR150', disp: 'BR150', slot: 1 },
  { id: 'BR150B', disp: 'BR150B', slot: 2 },
  { id: 'BR360B', disp: 'BR360B', slot: 3 },
  { id: 'VCR412', disp: 'VCR-412', slot: 4 },
  { id: 'VCR617', disp: 'VCR-617', slot: 5 },
  { id: 'BR150L', disp: 'BR150L', slot: 6 },
];

export function slotOf(gradeId: string): number {
  return GRADES.find((g) => g.id === gradeId)?.slot ?? 1;
}

export function dispOf(gradeId: string, grades?: GradeMeta[]): string {
  const list = grades ?? GRADES;
  return list.find((g) => g.id === gradeId)?.disp ?? gradeId;
}

export const DEMAND_DEFAULT: Record<string, number> = {
  BR150: 2600,
  BR150L: 900,
  BR150B: 1300,
  BR360B: 400,
  VCR412: 500,
  VCR617: 1000,
};

// Reactor-pair status per plan day, parallel to DAYS.
const PAIR_STATUS: [PairStatus, PairStatus][] = [
  ...Array(7).fill(['prod', 'idle']),
  ...Array(7).fill(['clean', 'prod']),
  ...Array(8).fill(['prod', 'prod']),
  ...Array(6).fill(['prod', 'clean']),
] as [PairStatus, PairStatus][];

const PAIR_NOTES: Record<string, string> = {
  'RX1-2': 'Age 54→60 · cleaning 7 days (Oct 12–18) · back in production, age 1→14 at plan end',
  'RX3-4': 'Standby at age 0 · substitute production age 1→7 · VCR-start age 7 ≤ 15 · sent to 7-day cleaning after VCR (until Nov 2)',
};

const REACTOR_PAIRS: [string, 0 | 1][] = [
  ['RX1', 0],
  ['RX2', 0],
  ['RX3', 1],
  ['RX4', 1],
];

const DAYS: Omit<PlanDay, 'p1' | 'p2' | 'reactors'>[] = [
  { iso: '2026-10-05', date: '5 Oct', wd: 'Mo', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX1-2', note: 'Continuing the previous campaign (min-run already satisfied)' },
  { iso: '2026-10-06', date: '6 Oct', wd: 'Tu', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX1-2', note: '' },
  { iso: '2026-10-07', date: '7 Oct', wd: 'We', wknd: false, chg: true, cap: 234, parts: [{ grade: 'BR150', tons: 100 }, { grade: 'BR150B', tons: 134 }], rx: 'RX1-2', note: 'Grade change per the 11-pair table' },
  { iso: '2026-10-08', date: '8 Oct', wd: 'Th', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150B', tons: 239 }], rx: 'RX1-2', note: '' },
  { iso: '2026-10-09', date: '9 Oct', wd: 'Fr', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150B', tons: 239 }], rx: 'RX1-2', note: '' },
  { iso: '2026-10-10', date: '10 Oct', wd: 'Sa', wknd: true, chg: false, cap: null, parts: [{ grade: 'BR150B', tons: 239 }], rx: 'RX1-2', note: 'Saturday — production continues' },
  { iso: '2026-10-11', date: '11 Oct', wd: 'Su', wknd: true, chg: false, cap: null, parts: [{ grade: 'BR150B', tons: 239 }], rx: 'RX1-2', note: 'RX1-2 age reaches exactly 60 days' },
  { iso: '2026-10-12', date: '12 Oct', wd: 'Mo', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150B', tons: 239 }], rx: 'RX3-4', note: 'RX1-2 enter 7-day cleaning → RX3-4 take over' },
  { iso: '2026-10-13', date: '13 Oct', wd: 'Tu', wknd: false, chg: true, cap: 225, parts: [{ grade: 'BR150B', tons: 115 }, { grade: 'BR360B', tons: 110 }], rx: 'RX3-4', note: 'BR150B→BR360B direct change allowed' },
  { iso: '2026-10-14', date: '14 Oct', wd: 'We', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR360B', tons: 230 }], rx: 'RX3-4', note: 'min-run ≥ 1 day' },
  { iso: '2026-10-15', date: '15 Oct', wd: 'Th', wknd: false, chg: true, cap: 225, parts: [{ grade: 'BR360B', tons: 115 }, { grade: 'BR150', tons: 110 }], rx: 'RX3-4', note: 'loss for this pair still assumed at −5 t' },
  { iso: '2026-10-16', date: '16 Oct', wd: 'Fr', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX3-4', note: '' },
  { iso: '2026-10-17', date: '17 Oct', wd: 'Sa', wknd: true, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX3-4', note: '' },
  { iso: '2026-10-18', date: '18 Oct', wd: 'Su', wknd: true, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX3-4', note: 'RX1-2 cleaning complete (7 days)' },
  { iso: '2026-10-19', date: '19 Oct', wd: 'Mo', wknd: false, chg: true, cap: 200, parts: [{ grade: 'BR150', tons: 120 }, { grade: 'VCR412', tons: 80 }], rx: 'RX1-4', note: 'RX1-2 back from cleaning (age 0) · VCR starts — RX3-4 age = 7 ≤ 15' },
  { iso: '2026-10-20', date: '20 Oct', wd: 'Tu', wknd: false, chg: false, cap: null, parts: [{ grade: 'VCR412', tons: 230 }], rx: 'RX1-4', note: '' },
  { iso: '2026-10-21', date: '21 Oct', wd: 'We', wknd: false, chg: false, cap: null, parts: [{ grade: 'VCR412', tons: 230 }], rx: 'RX1-4', note: '' },
  { iso: '2026-10-22', date: '22 Oct', wd: 'Th', wknd: false, chg: true, cap: 190, parts: [{ grade: 'VCR412', tons: 95 }, { grade: 'VCR617', tons: 95 }], rx: 'RX1-4', note: 'Switch within the VCR group (all 4 reactors running)' },
  { iso: '2026-10-23', date: '23 Oct', wd: 'Fr', wknd: false, chg: false, cap: null, parts: [{ grade: 'VCR617', tons: 220 }], rx: 'RX1-4', note: '' },
  { iso: '2026-10-24', date: '24 Oct', wd: 'Sa', wknd: true, chg: false, cap: null, parts: [{ grade: 'VCR617', tons: 220 }], rx: 'RX1-4', note: '' },
  { iso: '2026-10-25', date: '25 Oct', wd: 'Su', wknd: true, chg: false, cap: null, parts: [{ grade: 'VCR617', tons: 220 }], rx: 'RX1-4', note: '' },
  { iso: '2026-10-26', date: '26 Oct', wd: 'Mo', wknd: false, chg: false, cap: null, parts: [{ grade: 'VCR617', tons: 220 }], rx: 'RX1-4', note: 'VCR ends — 412+617 total 8 days · RX1-2 age = 8 < 50' },
  { iso: '2026-10-27', date: '27 Oct', wd: 'Tu', wknd: false, chg: true, cap: 95, parts: [{ grade: 'VCR617', tons: 30 }, { grade: 'BR150', tons: 65 }], rx: 'RX1-2', note: 'Monday switch out of VCR (holiday rule) · RX3-4 sent to 7-day cleaning' },
  { iso: '2026-10-28', date: '28 Oct', wd: 'We', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX1-2', note: '' },
  { iso: '2026-10-29', date: '29 Oct', wd: 'Th', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX1-2', note: '' },
  { iso: '2026-10-30', date: '30 Oct', wd: 'Fr', wknd: false, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX1-2', note: '' },
  { iso: '2026-10-31', date: '31 Oct', wd: 'Sa', wknd: true, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX1-2', note: '' },
  { iso: '2026-11-01', date: '1 Nov', wd: 'Su', wknd: true, chg: false, cap: null, parts: [{ grade: 'BR150', tons: 230 }], rx: 'RX1-2', note: 'End of horizon — RX1-2 age = 14 ≤ 60' },
];

const CHECKS: CheckItem[] = [
  { level: 'ok', text: 'All 6 changeovers are in the Allow_GradeChange table (BR150→BR150B, BR150B→BR360B, BR360B→BR150, BR150→VCR-412, VCR-412→VCR-617, VCR-617→BR150)' },
  { level: 'ok', text: 'Min-run: BR150B 5 days (≥4) · BR360B 1 day (≥1) · VCR-412 2 days (≥2) · VCR-617 4 days (≥2) · BR150 3 days (≥2)' },
  { level: 'ok', text: 'Changeover-day ceilings respected — 234 / 225 / 200 / 190 / 95 tons per the transition table' },
  { level: 'ok', text: 'VCR-412 + VCR-617 total 8 days (≥8) — the 412-only case still awaits client confirmation' },
  { level: 'ok', text: 'No VCR→BR150 change on holidays — VCR ends Monday Oct 26, switches out Tuesday' },
  { level: 'ok', text: 'RX ages: VCR start RX3-4 = 7 ≤ 15 · VCR end RX1-2 = 8 < 50 · plan end 14 ≤ 60' },
  { level: 'ok', text: 'No overlapping cleanings — RX1-2: Oct 12–18 / RX3-4: Oct 27–Nov 2' },
  { level: 'warn', text: 'Loss for BR360B→BR150 is an assumed −5 t (no official figure from production yet)' },
];

const ASSUMPTIONS: string[] = [
  'Min-run days count the changeover day as a day of the new grade',
  'Reactor age counts production days only (cleaning days excluded) — directly affects the 60/50/15-day rules',
  'On changeover days the split between the two groups is free within the combined ceiling of the pair',
  'Losses for BR150B→BR360B, BR360B→BR150, BR360B→BR150B, VCR-412→BR150 use an assumed −5 t',
  'Weekends and company holidays run production as usual; only VCR→BR150 grade changes are forbidden',
];

// Recompute KPIs/fulfillment from the fixed schedule and a demand map —
// the same math the backend stub runs, so the offline fallback behaves
// identically when the planner edits demand.
function buildSample(demand: Record<string, number>, solveS: number): OptimizeResult {
  const produced: Record<string, number> = {};
  GRADES.forEach((g) => {
    produced[g.id] = 0;
  });
  let totalTons = 0;
  let changeoverDays = 0;
  DAYS.forEach((d) => {
    d.parts.forEach((p) => {
      produced[p.grade] += p.tons;
      totalTons += p.tons;
    });
    if (d.chg) changeoverDays += 1;
  });

  const fulfillment: FulfillRow[] = GRADES.map((g) => {
    const prod = produced[g.id] ?? 0;
    const dem = demand[g.id] ?? 0;
    return {
      grade: g.id,
      disp: g.disp,
      slot: g.slot,
      produced: prod,
      demand: dem,
      shortage: Math.max(0, dem - prod),
    };
  });
  const totalDemand = fulfillment.reduce((a, r) => a + r.demand, 0);
  const met = fulfillment.reduce((a, r) => a + Math.min(r.produced, r.demand), 0);
  const shortage = fulfillment.reduce((a, r) => a + r.shortage, 0);

  return {
    status: 'feasible',
    mode: 'sample',
    solve_s: solveS,
    horizon_days: DAYS.length,
    start_date: DAYS[0].iso,
    grades: GRADES,
    demand_used: { ...demand },
    kpis: {
      status: 'Feasible',
      total_tons: totalTons,
      fulfillment_pct: totalDemand ? Math.round((met / totalDemand) * 1000) / 10 : 0,
      shortage_tons: shortage,
      changeover_days: changeoverDays,
      solve_s: solveS,
    },
    fulfillment,
    days: DAYS.map((d, i) => {
      const [p1, p2] = PAIR_STATUS[i];
      return {
        ...d,
        p1,
        p2,
        reactors: REACTOR_PAIRS.map(([id, pairIndex]) => {
          const status = pairIndex === 0 ? p1 : p2;
          return { id, status, parts: status === 'prod' ? d.parts : [] };
        }),
      };
    }),
    pair_notes: PAIR_NOTES,
    checks: CHECKS,
    assumptions: ASSUMPTIONS,
  };
}

export const SAMPLE_PLAN: OptimizeResult = buildSample(DEMAND_DEFAULT, 0);
