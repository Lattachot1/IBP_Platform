// Editable-plan model for the /optimize Gantt.
//
// A Draft is the hand-editable form of a plan: a campaign sequence that
// fills the horizon, cleaning windows per reactor pair and the pair plan
// (which pair runs the BR grades from a point in a campaign on). It
// mirrors EvaluateRequest in Backend/optimization/schemas.py; every edit
// here is pure data, the rule check happens on the backend
// (POST /api/v1/optimize/evaluate) so plant_config.yaml stays the only
// source of plant rules.

import type { OptimizeResult } from './samplePlan';

export type Pair = 'RX1-2' | 'RX3-4';

export interface Campaign {
  grade: string;
  days: number;
}

export interface Cleaning {
  pair: Pair;
  start: number; // day index within the horizon
}

/**
 * "From day `offset` of campaign `campaign` on, BR grades run on `pair`."
 * Anchored to campaigns (not day indexes) so the assignment follows the
 * campaigns when they are resized, swapped or split.
 */
export interface PairSegment {
  campaign: number;
  offset: number;
  pair: Pair;
}

export interface Draft {
  campaigns: Campaign[];
  cleanings: Cleaning[];
  pair_plan: PairSegment[];
}

/** Display length of a cleaning window; the backend uses plant_config.yaml. */
export const CLEAN_DAYS = 7;

export const PAIRS: Pair[] = ['RX1-2', 'RX3-4'];

export function pairOfReactor(reactorId: string): Pair {
  return reactorId === 'RX1' || reactorId === 'RX2' ? 'RX1-2' : 'RX3-4';
}

/** Main grade of each plan day (the incoming grade on changeover days). */
function mainsFromResult(res: OptimizeResult): string[] {
  const mains: string[] = [];
  res.days.forEach((d) => {
    if (!d.parts.length) {
      mains.push(mains[mains.length - 1] ?? '');
      return;
    }
    mains.push(d.chg && d.parts.length > 1 ? d.parts[d.parts.length - 1].grade : d.parts[0].grade);
  });
  return mains;
}

function windows(flags: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let d = 0;
  while (d < flags.length) {
    if (flags[d]) {
      const s = d;
      while (d < flags.length && flags[d]) d += 1;
      out.push([s, d - 1]);
    } else {
      d += 1;
    }
  }
  return out;
}

/** Start day index of every campaign. */
export function campaignStarts(draft: Draft): number[] {
  const starts: number[] = [];
  let d = 0;
  draft.campaigns.forEach((c) => {
    starts.push(d);
    d += c.days;
  });
  return starts;
}

export function horizonOf(draft: Draft): number {
  return draft.campaigns.reduce((a, c) => a + c.days, 0);
}

function locate(starts: number[], campaigns: Campaign[], day: number): { campaign: number; offset: number } {
  for (let k = campaigns.length - 1; k >= 0; k -= 1) {
    if (day >= starts[k]) return { campaign: k, offset: Math.min(day - starts[k], campaigns[k].days - 1) };
  }
  return { campaign: 0, offset: 0 };
}

/** Same derivation as manual.draft_from_result() on the backend. */
export function draftFromResult(res: OptimizeResult): Draft {
  const campaigns: Campaign[] = [];
  mainsFromResult(res).forEach((g) => {
    const last = campaigns[campaigns.length - 1];
    if (last && last.grade === g) last.days += 1;
    else campaigns.push({ grade: g, days: 1 });
  });
  // Back-to-back cleaning windows show up as one long run of "clean" days;
  // split every run into CLEAN_DAYS windows (the last may be cut off by
  // the horizon end).
  const cleanings: Cleaning[] = [];
  (['p1', 'p2'] as const).forEach((key, i) => {
    windows(res.days.map((d) => d[key] === 'clean')).forEach(([s, e]) => {
      for (let start = s; start <= e; start += CLEAN_DAYS) {
        cleanings.push({ pair: PAIRS[i], start });
      }
    });
  });
  const starts: number[] = [];
  let acc = 0;
  campaigns.forEach((c) => {
    starts.push(acc);
    acc += c.days;
  });
  const pair_plan: PairSegment[] = [];
  let cur: Pair | null = null;
  res.days.forEach((d, i) => {
    if (d.p1 === 'prod' && d.p2 === 'prod') return; // VCR day — both by rule
    const pair: Pair | null = d.p1 === 'prod' ? 'RX1-2' : d.p2 === 'prod' ? 'RX3-4' : null;
    if (pair && pair !== cur) {
      pair_plan.push({ ...locate(starts, campaigns, i), pair });
      cur = pair;
    }
  });
  return { campaigns, cleanings, pair_plan };
}

function cloneSegments(segments: PairSegment[]): PairSegment[] {
  return segments.map((s) => ({ ...s }));
}

/**
 * Merge adjacent campaigns of the same grade, drop empty ones and keep the
 * pair plan attached to the right campaign/offset through the merge.
 */
export function normalize(draft: Draft): Draft {
  const campaigns: Campaign[] = [];
  // original index -> [new index, offset shift]
  const map: [number, number][] = [];
  draft.campaigns.forEach((c) => {
    if (c.days < 1) {
      map.push([-1, 0]);
      return;
    }
    const last = campaigns[campaigns.length - 1];
    if (last && last.grade === c.grade) {
      map.push([campaigns.length - 1, last.days]);
      last.days += c.days;
    } else {
      map.push([campaigns.length, 0]);
      campaigns.push({ ...c });
    }
  });
  const seen = new Set<string>();
  const pair_plan: PairSegment[] = [];
  draft.pair_plan
    .map((s) => {
      const m = map[s.campaign];
      if (!m || m[0] < 0) return null;
      const target = campaigns[m[0]];
      return { campaign: m[0], offset: Math.min(target.days - 1, Math.max(0, s.offset + m[1])), pair: s.pair };
    })
    .filter((s): s is PairSegment => !!s)
    .sort((a, b) => a.campaign - b.campaign || a.offset - b.offset)
    .forEach((s) => {
      const key = `${s.campaign}:${s.offset}`;
      if (seen.has(key)) {
        // later segment at the same spot wins
        pair_plan[pair_plan.length - 1] = s;
        return;
      }
      seen.add(key);
      pair_plan.push(s);
    });
  const cleanings = draft.cleanings
    .map((c) => ({ ...c }))
    .sort((a, b) => a.pair.localeCompare(b.pair) || a.start - b.start);
  return { campaigns, cleanings, pair_plan };
}

/**
 * Give campaign `index` exactly `days` days, taking them from (or handing
 * them to) the following campaign so the horizon stays filled. The last
 * campaign cannot be resized this way (resize the one before it).
 */
export function resizeCampaign(draft: Draft, index: number, days: number): Draft {
  const next = draft.campaigns[index + 1];
  if (!next) return draft;
  const total = draft.campaigns[index].days + next.days;
  const want = Math.min(total - 1, Math.max(1, Math.round(days)));
  const campaigns = draft.campaigns.map((c) => ({ ...c }));
  campaigns[index].days = want;
  campaigns[index + 1].days = total - want;
  return normalize({ ...draft, campaigns, pair_plan: cloneSegments(draft.pair_plan) });
}

export function swapCampaign(draft: Draft, index: number, dir: -1 | 1): Draft {
  const j = index + dir;
  if (j < 0 || j >= draft.campaigns.length) return draft;
  const campaigns = draft.campaigns.map((c) => ({ ...c }));
  [campaigns[index], campaigns[j]] = [campaigns[j], campaigns[index]];
  const pair_plan = draft.pair_plan.map((s) => ({
    ...s,
    campaign: s.campaign === index ? j : s.campaign === j ? index : s.campaign,
  }));
  return normalize({ ...draft, campaigns, pair_plan });
}

/** Carve a new campaign of `grade` out of the end of campaign `index`. */
export function splitCampaign(draft: Draft, index: number, grade: string): Draft {
  const c = draft.campaigns[index];
  if (!c || c.days < 2) return draft;
  const newDays = Math.min(2, c.days - 1);
  const keep = c.days - newDays;
  const campaigns = draft.campaigns.map((x) => ({ ...x }));
  campaigns[index].days = keep;
  campaigns.splice(index + 1, 0, { grade, days: newDays });
  const pair_plan = draft.pair_plan.map((s) => {
    if (s.campaign > index) return { ...s, campaign: s.campaign + 1 };
    if (s.campaign === index && s.offset >= keep) return { ...s, campaign: index + 1, offset: s.offset - keep };
    return { ...s };
  });
  return normalize({ ...draft, campaigns, pair_plan });
}

/** Remove campaign `index`; its days go to the previous campaign (or the next one for the first). */
export function removeCampaign(draft: Draft, index: number): Draft {
  if (draft.campaigns.length < 2) return draft;
  const campaigns = draft.campaigns.map((x) => ({ ...x }));
  const [gone] = campaigns.splice(index, 1);
  const target = index > 0 ? index - 1 : 0;
  campaigns[target].days += gone.days;
  const pair_plan = draft.pair_plan
    .filter((s) => s.campaign !== index)
    .map((s) => {
      if (s.campaign > index) {
        // the first campaign's days were prepended to the new first one
        const shift = index === 0 && s.campaign === 1 ? gone.days : 0;
        return { ...s, campaign: s.campaign - 1, offset: s.offset + shift };
      }
      return { ...s };
    });
  return normalize({ ...draft, campaigns, pair_plan });
}

export function setCampaignGrade(draft: Draft, index: number, grade: string): Draft {
  const campaigns = draft.campaigns.map((x, i) => (i === index ? { ...x, grade } : { ...x }));
  return normalize({ ...draft, campaigns, pair_plan: cloneSegments(draft.pair_plan) });
}

export function moveCleaning(draft: Draft, index: number, start: number, horizon: number): Draft {
  const cleanings = draft.cleanings.map((c, i) =>
    i === index ? { ...c, start: Math.min(horizon - 1, Math.max(0, Math.round(start))) } : { ...c },
  );
  return { ...draft, cleanings };
}

export function addCleaning(draft: Draft, pair: Pair, start: number): Draft {
  return normalize({ ...draft, cleanings: [...draft.cleanings, { pair, start: Math.max(0, start) }] });
}

export function removeCleaning(draft: Draft, index: number): Draft {
  return { ...draft, cleanings: draft.cleanings.filter((_, i) => i !== index) };
}

/** Index of the cleaning window of `pair` covering `day`, or -1. */
export function cleaningAt(draft: Draft, pair: Pair, day: number): number {
  return draft.cleanings.findIndex((c) => c.pair === pair && day >= c.start && day < c.start + CLEAN_DAYS);
}

/** Day indexes flagged by conflict-level checks of a result. */
export function conflictDaysOf(res: OptimizeResult | null): Set<number> {
  const out = new Set<number>();
  res?.checks.forEach((c) => {
    if (c.level === 'conflict') (c.days ?? []).forEach((d) => out.add(d));
  });
  return out;
}

export function conflictCount(res: OptimizeResult | null): number {
  if (!res) return 0;
  if (typeof res.conflicts === 'number') return res.conflicts;
  return res.checks.filter((c) => c.level === 'conflict').length;
}
