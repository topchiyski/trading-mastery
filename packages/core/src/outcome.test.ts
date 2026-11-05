import { describe, expect, it } from 'vitest';
import { toMicros as $ } from './money';
import { classifyOutcome, outcomeStats } from './outcome';

describe('classifyOutcome', () => {
  it('treats |net| below the threshold (default $1) as break-even', () => {
    expect(classifyOutcome($('0.5'))).toBe('BREAKEVEN');
    expect(classifyOutcome($('-0.99'))).toBe('BREAKEVEN');
    expect(classifyOutcome($('1'))).toBe('WIN');
    expect(classifyOutcome($('-1'))).toBe('LOSS');
    expect(classifyOutcome($('3'), $('5'))).toBe('BREAKEVEN');
  });
});

describe('outcomeStats', () => {
  const trades = [
    { netPnl: $('300'), rMultiple: 1.5 },
    { netPnl: $('-100'), rMultiple: -0.5 },
    { netPnl: $('0.5'), rMultiple: null }, // break-even, no stop
    { netPnl: $('-200'), rMultiple: -1 },
  ];

  it('counts break-evens separately from wins and losses', () => {
    const s = outcomeStats(trades);
    expect(s).toMatchObject({ count: 4, wins: 1, losses: 2, breakEvens: 1 });
    expect(s.winRate).toBeCloseTo(1 / 3, 10); // wins ÷ (wins + losses)
  });

  it('aggregates $ and R', () => {
    const s = outcomeStats(trades);
    expect(s.totalNetPnl).toBe($('0.5'));
    expect(s.grossWins).toBe($('300'));
    expect(s.grossLosses).toBe($('-300'));
    expect(s.avgWin).toBe($('300'));
    expect(s.avgLoss).toBe($('-150'));
    expect(s.expectancy).toBe(125_000); // 0.5 / 4 = 0.125
    expect(s.expectancyR).toBeCloseTo(0, 10); // (1.5 − 0.5 − 1) / 3
    expect(s.rTradeCount).toBe(3);
    expect(s.rExcludedCount).toBe(1);
  });

  it('returns nulls for an empty set', () => {
    expect(outcomeStats([])).toMatchObject({
      count: 0,
      winRate: null,
      avgWin: null,
      avgLoss: null,
      expectancy: null,
      expectancyR: null,
    });
  });
});
