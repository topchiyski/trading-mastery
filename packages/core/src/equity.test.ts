import { describe, expect, it } from 'vitest';
import { toMicros as $ } from './money';
import { buildEquitySeries, cumulativeRCurve } from './equity';

describe('buildEquitySeries', () => {
  it('does not count a mid-period deposit as return (TWR)', () => {
    // Start 10,000 on Mon Mar 2. Tue: +1,000 trade (equity 11,000, +10%).
    // Wed: deposit 11,000 (equity 22,000, 0%). Thu: +2,200 trade (equity 24,200, +10%).
    // TWR = 1.1 × 1.1 − 1 = 21%; a naive (24,200 − 10,000) / 10,000 would claim 142%.
    const series = buildEquitySeries({
      startingBalance: $('10000'),
      startDate: '2026-03-02',
      endDate: '2026-03-06',
      cashFlows: [{ type: 'DEPOSIT', amount: $('11000'), occurredAt: '2026-03-04T14:00:00Z' }],
      closedTrades: [
        { netPnl: $('1000'), closedAt: '2026-03-03T20:00:00Z' },
        { netPnl: $('2200'), closedAt: '2026-03-05T20:00:00Z' },
      ],
    });
    expect(series.map((p) => p.date)).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
    ]);
    expect(series.map((p) => p.equity)).toEqual(
      ['10000', '11000', '22000', '24200', '24200'].map((v) => $(v)),
    );
    const returns = series.map((p) => p.dailyReturn);
    [0, 0.1, 0, 0.1, 0].forEach((r, i) => expect(returns[i]).toBeCloseTo(r, 12));
    expect(series.at(-1)!.twrIndex).toBeCloseTo(1.21, 12);
    expect(series.at(-1)!.externalFlowsCum).toBe($('11000'));
    expect(series.at(-1)!.realisedPnlCum).toBe($('3200'));
  });

  it('treats dividends, interest and fees as performance, not external flows', () => {
    const series = buildEquitySeries({
      startingBalance: $('1000'),
      startDate: '2026-03-02',
      endDate: '2026-03-03',
      cashFlows: [
        { type: 'DIVIDEND', amount: $('20'), occurredAt: '2026-03-03' },
        { type: 'FEE', amount: $('-10'), occurredAt: '2026-03-03' },
      ],
      closedTrades: [],
    });
    expect(series[1]).toMatchObject({
      equity: $('1010'),
      incomeCum: $('10'),
      performanceCum: $('10'),
    });
    expect(series[1]!.dailyReturn).toBeCloseTo(0.01, 12);
  });

  it('measures drawdown on performance $ and on the TWR index, ignoring withdrawals', () => {
    // Mar 2: −500 trade. Mar 3: withdraw 2,000 (no drawdown from that). Mar 4: +800 trade.
    const series = buildEquitySeries({
      startingBalance: $('10000'),
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      cashFlows: [{ type: 'WITHDRAWAL', amount: $('-2000'), occurredAt: '2026-03-03' }],
      closedTrades: [
        { netPnl: $('-500'), closedAt: '2026-03-02T20:00:00Z' },
        { netPnl: $('800'), closedAt: '2026-03-04T20:00:00Z' },
      ],
    });
    expect(series.map((p) => p.performanceDrawdown)).toEqual([$('-500'), $('-500'), 0]);
    expect(series[0]!.twrDrawdownPct).toBeCloseTo(-0.05, 12);
    expect(series[1]!.twrDrawdownPct).toBeCloseTo(-0.05, 12); // withdrawal is not a loss
    expect(series[1]!.dailyReturn).toBe(0);
    // Mar 4: +800 on 7,500 = +10.667%; index 0.95 × 1.10667 = 1.05133 -> new high, no drawdown
    expect(series[2]!.twrDrawdownPct).toBe(0);
    expect(series[2]!.twrIndex).toBeCloseTo(0.95 * (1 + 800 / 7500), 12);
  });

  it('rolls weekend and pre-start events forward and drops events after the end', () => {
    const series = buildEquitySeries({
      startingBalance: $('1000'),
      startDate: '2026-03-06', // Fri
      endDate: '2026-03-09', // Mon
      cashFlows: [
        { type: 'DEPOSIT', amount: $('100'), occurredAt: '2026-03-01' }, // before start -> Fri
        { type: 'DEPOSIT', amount: $('50'), occurredAt: '2026-03-07' }, // Sat -> Mon
        { type: 'DEPOSIT', amount: $('999'), occurredAt: '2026-03-20' }, // after end -> dropped
      ],
      closedTrades: [],
    });
    expect(series.map((p) => [p.date, p.equity])).toEqual([
      ['2026-03-06', $('1100')],
      ['2026-03-09', $('1150')],
    ]);
  });

  it('handles a zero starting balance funded by a deposit', () => {
    const series = buildEquitySeries({
      startingBalance: 0,
      startDate: '2026-03-02',
      endDate: '2026-03-03',
      cashFlows: [{ type: 'DEPOSIT', amount: $('5000'), occurredAt: '2026-03-02' }],
      closedTrades: [{ netPnl: $('500'), closedAt: '2026-03-03T20:00:00Z' }],
    });
    expect(series[0]!.dailyReturn).toBe(0);
    expect(series[1]!.dailyReturn).toBeCloseTo(0.1, 12);
  });

  it('returns no points when the range has no trading days', () => {
    expect(
      buildEquitySeries({
        startingBalance: 0,
        startDate: '2026-03-07',
        endDate: '2026-03-08',
        cashFlows: [],
        closedTrades: [],
      }),
    ).toEqual([]);
  });
});

describe('cumulativeRCurve', () => {
  it('accumulates R in close order and tracks R drawdown from 0', () => {
    const { points, excluded } = cumulativeRCurve([
      { stableKey: 3, closedAt: '2026-03-04T20:00:00Z', rMultiple: 2 },
      { stableKey: 1, closedAt: '2026-03-02T20:00:00Z', rMultiple: -1 },
      { stableKey: 2, closedAt: '2026-03-03T20:00:00Z', rMultiple: null },
      { stableKey: 4, closedAt: '2026-03-05T20:00:00Z', rMultiple: -0.5 },
    ]);
    expect(excluded).toBe(1);
    expect(points).toEqual([
      { stableKey: 1, closedAt: '2026-03-02T20:00:00Z', rMultiple: -1, cumR: -1, drawdownR: -1 },
      { stableKey: 3, closedAt: '2026-03-04T20:00:00Z', rMultiple: 2, cumR: 1, drawdownR: 0 },
      {
        stableKey: 4,
        closedAt: '2026-03-05T20:00:00Z',
        rMultiple: -0.5,
        cumR: 0.5,
        drawdownR: -0.5,
      },
    ]);
  });
});
