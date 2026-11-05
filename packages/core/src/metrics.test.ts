import { describe, expect, it } from 'vitest';
import { buildEquitySeries } from './equity';
import {
  METRIC_DEFINITIONS,
  computePortfolioMetrics,
  sharpeRatio,
  sortinoRatio,
  type MetricsTrade,
} from './metrics';
import { toMicros as $ } from './money';

const t = (
  stableKey: number,
  net: string,
  rMultiple: number | null,
  fees: string,
  closedDay: number,
  calendarDays: number,
  tradingDays: number,
): MetricsTrade => ({
  stableKey,
  netPnl: $(net),
  fees: $(fees),
  rMultiple,
  closedAt: `2026-03-${String(closedDay).padStart(2, '0')}T20:00:00Z`,
  holding: { calendarDays, tradingDays },
});

// Close order: W, L, BE, L, W, W (passed in shuffled order on purpose).
const trades: MetricsTrade[] = [
  t(5, '500', 2.5, '3', 9, 10, 8),
  t(1, '300', 1.5, '2', 2, 5, 4),
  t(3, '0.5', null, '1', 4, 1, 1), // break-even, no stop
  t(2, '-100', -0.5, '2', 3, 3, 2),
  t(6, '100', null, '1', 10, 4, 3), // win, no stop
  t(4, '-200', -1, '2', 5, 2, 2),
];

describe('computePortfolioMetrics — hand-calculated', () => {
  const m = computePortfolioMetrics(trades);

  it('counts outcomes with break-evens kept separate', () => {
    expect(m).toMatchObject({ count: 6, wins: 3, losses: 2, breakEvens: 1 });
    expect(m.winRate).toBeCloseTo(0.6, 12); // 3 / (3 + 2)
  });

  it('computes $ statistics', () => {
    expect(m.totalNetPnl).toBe($('600.5'));
    expect(m.avgWin).toBe($('300')); // 900 / 3
    expect(m.avgLoss).toBe($('-150')); // −300 / 2
    expect(m.payoffRatio).toBe(2); // 300 / 150
    expect(m.profitFactor).toBe(3); // 900 / 300
    expect(m.expectancy).toBe(100_083_333); // 600.5 / 6
    expect(m.largestWin).toBe($('500'));
    expect(m.largestLoss).toBe($('-200'));
    expect(m.totalFees).toBe($('11'));
  });

  it('computes R statistics over trades with a stop only', () => {
    expect(m.expectancyR).toBeCloseTo(0.625, 12); // (1.5 − 0.5 − 1 + 2.5) / 4
    expect(m.rTradeCount).toBe(4);
    expect(m.rExcludedCount).toBe(2);
  });

  it('computes streaks in close order, skipping break-evens', () => {
    // W, L, (BE), L, W, W
    expect(m.longestWinStreak).toBe(2);
    expect(m.longestLossStreak).toBe(2);
  });

  it('averages holding periods for winners vs losers', () => {
    expect(m.avgHoldingWinners!.calendarDays).toBeCloseTo(19 / 3, 12); // (5 + 10 + 4) / 3
    expect(m.avgHoldingWinners!.tradingDays).toBe(5); // (4 + 8 + 3) / 3
    expect(m.avgHoldingLosers).toEqual({ calendarDays: 2.5, tradingDays: 2 });
  });

  it('leaves equity-based metrics empty without an equity series', () => {
    expect(m.maxDrawdown).toBeNull();
    expect(m.maxDrawdownPct).toBeNull();
    expect(m.sharpe).toBeNull();
    expect(m.sortino).toBeNull();
  });

  it('respects a custom break-even threshold', () => {
    const wide = computePortfolioMetrics(trades, { breakEvenThreshold: $('150') });
    expect(wide).toMatchObject({ wins: 2, losses: 1, breakEvens: 3 });
  });
});

describe('computePortfolioMetrics — edge cases', () => {
  it('handles an empty set', () => {
    const m = computePortfolioMetrics([]);
    expect(m).toMatchObject({
      count: 0,
      payoffRatio: null,
      profitFactor: null,
      largestWin: null,
      largestLoss: null,
      longestWinStreak: 0,
      longestLossStreak: 0,
      avgHoldingWinners: null,
      avgHoldingLosers: null,
      totalFees: 0,
    });
  });

  it('reports no profit factor or payoff ratio when there are no losses', () => {
    const m = computePortfolioMetrics([t(1, '100', 1, '1', 2, 1, 1)]);
    expect(m.profitFactor).toBeNull();
    expect(m.payoffRatio).toBeNull();
  });
});

describe('computePortfolioMetrics — with an equity series', () => {
  it('takes max drawdown $ from performance and % from TWR, plus Sharpe/Sortino', () => {
    const equity = buildEquitySeries({
      startingBalance: $('10000'),
      startDate: '2026-03-02',
      endDate: '2026-03-05',
      cashFlows: [{ type: 'DEPOSIT', amount: $('5000'), occurredAt: '2026-03-04' }],
      closedTrades: [
        { netPnl: $('1000'), closedAt: '2026-03-02T20:00:00Z' }, // 11,000 (+10%)
        { netPnl: $('-2200'), closedAt: '2026-03-03T20:00:00Z' }, // 8,800 (−20%)
        { netPnl: $('1380'), closedAt: '2026-03-05T20:00:00Z' }, // 13,800 + 1,380 = 15,180 (+10%)
      ],
    });
    const m = computePortfolioMetrics([], { equity });
    expect(m.maxDrawdown).toBe($('-2200')); // performance 1,000 -> −1,200
    expect(m.maxDrawdownPct).toBeCloseTo(-0.2, 12); // TWR 1.1 -> 0.88
    expect(m.sharpe).toBeCloseTo(sharpeRatio([0.1, -0.2, 0, 0.1])!, 12);
    expect(m.sortino).toBeCloseTo(sortinoRatio([0.1, -0.2, 0, 0.1])!, 12);
  });
});

describe('sharpeRatio / sortinoRatio', () => {
  const returns = [0.01, -0.01, 0.02, 0];

  it('annualises mean ÷ sample stdev by √252', () => {
    // mean 0.005, sample var = 5e-4 / 3, stdev 0.0129099 -> 0.387298 × 15.874508 = 6.14817
    expect(sharpeRatio(returns)).toBeCloseTo(6.14817, 4);
  });

  it('annualises mean ÷ downside deviation by √252', () => {
    // downside dev = √((−0.01)² / 4) = 0.005 -> 1 × √252
    expect(sortinoRatio(returns)).toBeCloseTo(Math.sqrt(252), 10);
  });

  it('is null when undefined', () => {
    expect(sharpeRatio([0.01])).toBeNull();
    expect(sharpeRatio([0.01, 0.01])).toBeNull(); // zero volatility
    expect(sortinoRatio([0.01, 0.02])).toBeNull(); // no downside
    expect(sortinoRatio([])).toBeNull();
  });
});

describe('METRIC_DEFINITIONS', () => {
  it('has a label and tooltip definition for every portfolio metric', () => {
    const keys = Object.keys(computePortfolioMetrics(trades)).sort();
    expect(Object.keys(METRIC_DEFINITIONS).sort()).toEqual(keys);
    for (const def of Object.values(METRIC_DEFINITIONS)) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.definition.length).toBeGreaterThan(10);
    }
  });
});
