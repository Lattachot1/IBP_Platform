import { describe, expect, it } from 'vitest';

import {
  addCleaning,
  campaignStarts,
  cleaningAt,
  conflictCount,
  conflictDaysOf,
  draftFromResult,
  horizonOf,
  normalize,
  removeCampaign,
  resizeCampaign,
  setCampaignGrade,
  splitCampaign,
  swapCampaign,
  type Draft,
} from './manualPlan';
import { SAMPLE_PLAN, type OptimizeResult } from './samplePlan';

// 28-day draft: BR150 10d | VCR617 10d | BR150L 8d, BR grades on RX1-2
// from day 0 and on RX3-4 from day 3 of the last campaign.
const base: Draft = {
  campaigns: [
    { grade: 'BR150', days: 10 },
    { grade: 'VCR617', days: 10 },
    { grade: 'BR150L', days: 8 },
  ],
  cleanings: [{ pair: 'RX1-2', start: 12 }],
  pair_plan: [
    { campaign: 0, offset: 0, pair: 'RX1-2' },
    { campaign: 2, offset: 3, pair: 'RX3-4' },
  ],
};

/** Absolute day index of every pair-plan segment. */
function segmentDays(draft: Draft): number[] {
  const starts = campaignStarts(draft);
  return draft.pair_plan.map((s) => starts[s.campaign] + s.offset);
}

describe('draftFromResult', () => {
  const draft = draftFromResult(SAMPLE_PLAN);

  it('fills the whole horizon of the plan', () => {
    expect(horizonOf(draft)).toBe(SAMPLE_PLAN.days.length);
  });

  it('turns each cleaning run into a window per reactor pair', () => {
    expect(draft.cleanings).toEqual([
      { pair: 'RX1-2', start: 7 },
      { pair: 'RX3-4', start: 22 },
    ]);
  });

  it('records a pair-plan segment wherever the BR pair changes', () => {
    expect(draft.pair_plan.map((s) => s.pair)).toEqual(['RX1-2', 'RX3-4', 'RX1-2']);
    expect(segmentDays(draft)).toEqual([0, 7, 22]);
  });
});

describe('normalize', () => {
  it('merges neighbours of the same grade and drops empty campaigns', () => {
    const d = normalize({
      ...base,
      campaigns: [
        { grade: 'BR150', days: 10 },
        { grade: 'VCR617', days: 0 },
        { grade: 'BR150', days: 18 },
      ],
      pair_plan: [{ campaign: 2, offset: 4, pair: 'RX3-4' }],
    });
    expect(d.campaigns).toEqual([{ grade: 'BR150', days: 28 }]);
    // the segment keeps its absolute day (10 + 4) through the merge
    expect(d.pair_plan).toEqual([{ campaign: 0, offset: 14, pair: 'RX3-4' }]);
  });

  it('lets the later segment win when two land on the same day', () => {
    const d = normalize({
      ...base,
      pair_plan: [
        { campaign: 1, offset: 2, pair: 'RX1-2' },
        { campaign: 1, offset: 2, pair: 'RX3-4' },
      ],
    });
    expect(d.pair_plan).toEqual([{ campaign: 1, offset: 2, pair: 'RX3-4' }]);
  });
});

describe('campaign edits keep the horizon filled', () => {
  const edits: [string, (d: Draft) => Draft][] = [
    ['resize', (d) => resizeCampaign(d, 0, 15)],
    ['swap', (d) => swapCampaign(d, 1, 1)],
    ['split', (d) => splitCampaign(d, 0, 'BR150B')],
    ['remove first', (d) => removeCampaign(d, 0)],
    ['remove middle', (d) => removeCampaign(d, 1)],
    ['set grade', (d) => setCampaignGrade(d, 1, 'BR150')],
  ];

  it.each(edits)('%s', (_, edit) => {
    expect(horizonOf(edit(base))).toBe(28);
  });

  it.each(edits)('%s does not mutate its input', (_, edit) => {
    const before = structuredClone(base);
    edit(base);
    expect(base).toEqual(before);
  });
});

describe('resizeCampaign', () => {
  it('takes the days from the next campaign', () => {
    expect(resizeCampaign(base, 0, 15).campaigns.map((c) => c.days)).toEqual([15, 5, 8]);
  });

  it('never shrinks the next campaign below one day', () => {
    expect(resizeCampaign(base, 0, 99).campaigns.map((c) => c.days)).toEqual([19, 1, 8]);
  });

  it('cannot resize the last campaign', () => {
    expect(resizeCampaign(base, 2, 3)).toBe(base);
  });
});

describe('swapCampaign', () => {
  it('moves the pair plan along with its campaign', () => {
    const d = swapCampaign(base, 1, 1);
    expect(d.campaigns.map((c) => c.grade)).toEqual(['BR150', 'BR150L', 'VCR617']);
    expect(d.pair_plan[1]).toEqual({ campaign: 1, offset: 3, pair: 'RX3-4' });
  });

  it('ignores a swap past either end', () => {
    expect(swapCampaign(base, 0, -1)).toBe(base);
    expect(swapCampaign(base, 2, 1)).toBe(base);
  });
});

describe('splitCampaign', () => {
  it('carves two days off the end of the campaign', () => {
    const d = splitCampaign(base, 2, 'BR150B');
    expect(d.campaigns.slice(2)).toEqual([
      { grade: 'BR150L', days: 6 },
      { grade: 'BR150B', days: 2 },
    ]);
  });

  it('keeps every pair-plan segment on the same absolute day', () => {
    const late: Draft = { ...base, pair_plan: [{ campaign: 2, offset: 7, pair: 'RX3-4' }] };
    expect(segmentDays(splitCampaign(late, 2, 'BR150B'))).toEqual(segmentDays(late));
  });

  it('does not split a one-day campaign', () => {
    const tiny: Draft = { ...base, campaigns: [{ grade: 'BR150', days: 1 }, { grade: 'BR150L', days: 27 }] };
    expect(splitCampaign(tiny, 0, 'BR150B')).toBe(tiny);
  });
});

describe('removeCampaign', () => {
  it('gives the days to the previous campaign', () => {
    expect(removeCampaign(base, 1).campaigns).toEqual([
      { grade: 'BR150', days: 20 },
      { grade: 'BR150L', days: 8 },
    ]);
  });

  it('gives the first campaign days to the new first one, keeping segment days', () => {
    const d = removeCampaign(base, 0);
    expect(d.campaigns[0]).toEqual({ grade: 'VCR617', days: 20 });
    expect(segmentDays(d)).toEqual([20 + 3]);
  });

  it('keeps the only campaign', () => {
    const one: Draft = { ...base, campaigns: [{ grade: 'BR150', days: 28 }], pair_plan: [] };
    expect(removeCampaign(one, 0)).toBe(one);
  });
});

describe('cleanings', () => {
  it('finds the window covering a day (7 days long)', () => {
    expect(cleaningAt(base, 'RX1-2', 12)).toBe(0);
    expect(cleaningAt(base, 'RX1-2', 18)).toBe(0);
    expect(cleaningAt(base, 'RX1-2', 19)).toBe(-1);
    expect(cleaningAt(base, 'RX3-4', 12)).toBe(-1);
  });

  it('adds windows sorted by pair then start, clamped at day 0', () => {
    const d = addCleaning(addCleaning(base, 'RX1-2', -3), 'RX3-4', 2);
    expect(d.cleanings).toEqual([
      { pair: 'RX1-2', start: 0 },
      { pair: 'RX1-2', start: 12 },
      { pair: 'RX3-4', start: 2 },
    ]);
  });
});

describe('conflicts', () => {
  const evaluated = {
    ...SAMPLE_PLAN,
    checks: [
      { level: 'ok', text: 'transitions' },
      { level: 'conflict', text: 'ceiling', days: [3, 4] },
      { level: 'warn', text: 'age', days: [9] },
      { level: 'conflict', text: 'weekday', days: [4, 11] },
    ],
  } satisfies OptimizeResult;

  it('collects the days of conflict-level checks only', () => {
    expect(Array.from(conflictDaysOf(evaluated)).sort((a, b) => a - b)).toEqual([3, 4, 11]);
    expect(conflictDaysOf(null).size).toBe(0);
  });

  it('prefers the backend conflict count when present', () => {
    expect(conflictCount(evaluated)).toBe(2);
    expect(conflictCount({ ...evaluated, conflicts: 5 })).toBe(5);
    expect(conflictCount(null)).toBe(0);
  });
});
