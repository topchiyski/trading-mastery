import { describe, expect, it } from 'vitest';
import { toMicros as $ } from './money';
import { toQuantity as sh } from './quantity';
import { benchmarkIndex, detectSplits, excursions, type DailyBar } from './market';

const bar = (date: string, low: string, high: string, close = high): DailyBar => ({
  date,
  open: $(low),
  high: $(high),
  low: $(low),
  close: $(close),
});

describe('excursions (MAE / MFE from daily bars)', () => {
  it('measures the worst low and best high against the average entry', () => {
    // Avg entry 50, 100 sh, initial risk $200. Lowest low 47 -> MAE −3/sh; highest high 56 -> MFE +6/sh.
    const x = excursions({
      avgEntry: $('50'),
      quantity: sh(100),
      initialRisk: $('200'),
      bars: [
        bar('2026-03-02', '49', '51'),
        bar('2026-03-03', '47', '53'),
        bar('2026-03-04', '52', '56'),
      ],
    });
    expect(x).toEqual({
      mae: { perShare: $('-3'), dollars: $('-300'), pct: -0.06, r: -1.5 },
      mfe: { perShare: $('6'), dollars: $('600'), pct: 0.12, r: 3 },
      lowestLow: $('47'),
      highestHigh: $('56'),
      bars: 3,
    });
  });

  it('never reports a favourable MAE or an adverse MFE', () => {
    const x = excursions({
      avgEntry: $('50'),
      quantity: sh(10),
      initialRisk: null,
      bars: [bar('2026-03-02', '50.5', '52')],
    });
    expect(x?.mae).toEqual({ perShare: 0, dollars: 0, pct: 0, r: null });
    expect(x?.mfe.r).toBeNull(); // no stop -> no R
  });

  it('works with fractional quantities', () => {
    const x = excursions({
      avgEntry: $('284.10'),
      quantity: sh('0.5'),
      initialRisk: null,
      bars: [bar('2026-05-18', '280.10', '290.10')],
    });
    expect(x?.mae.dollars).toBe($('-2'));
    expect(x?.mfe.dollars).toBe($('3'));
  });

  it('is null without bars', () => {
    expect(
      excursions({ avgEntry: $('1'), quantity: sh(1), initialRisk: null, bars: [] }),
    ).toBeNull();
  });
});

describe('detectSplits', () => {
  it('uses the provider split factor when present', () => {
    expect(
      detectSplits([
        { date: '2026-06-09', close: $('400') },
        { date: '2026-06-10', close: $('100'), splitFactor: 4 },
      ]),
    ).toEqual([{ date: '2026-06-10', ratio: 4, source: 'provider' }]);
  });

  it('flags close-to-close jumps near a whole split ratio', () => {
    expect(
      detectSplits([
        { date: '2026-06-09', close: $('300') },
        { date: '2026-06-10', close: $('151') }, // ≈ 2:1
        { date: '2026-06-11', close: $('150') },
        { date: '2026-06-12', close: $('451') }, // ≈ 1:3 reverse split
        { date: '2026-06-15', close: $('420') }, // −7%: normal move
      ]),
    ).toEqual([
      { date: '2026-06-10', ratio: 2, source: 'price-jump' },
      { date: '2026-06-12', ratio: 1 / 3, source: 'price-jump' },
    ]);
  });

  it('ignores ordinary moves', () => {
    expect(
      detectSplits([
        { date: 'a', close: $('100') },
        { date: 'b', close: $('140') },
      ]),
    ).toEqual([]);
  });
});

describe('benchmarkIndex', () => {
  it('indexes prices to 100 on the first date and carries the last price over gaps', () => {
    const prices = new Map([
      ['2026-03-02', $('500')],
      ['2026-03-03', $('510')],
      ['2026-03-05', $('495')],
    ]);
    expect(
      benchmarkIndex(prices, ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']),
    ).toEqual([
      { date: '2026-03-02', value: 100 },
      { date: '2026-03-03', value: 102 },
      { date: '2026-03-04', value: 102 },
      { date: '2026-03-05', value: 99 },
    ]);
  });

  it('starts at the first date that has a price', () => {
    const prices = new Map([['2026-03-03', $('50')]]);
    expect(benchmarkIndex(prices, ['2026-03-02', '2026-03-03'])).toEqual([
      { date: '2026-03-02', value: null },
      { date: '2026-03-03', value: 100 },
    ]);
  });
});
