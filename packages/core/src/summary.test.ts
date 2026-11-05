import { describe, expect, it } from 'vitest';
import { at, fill } from './__fixtures__/fill';
import { groupExecutions } from './grouping';
import { toMicros as $ } from './money';
import { summarizeTrade } from './summary';

const tradeOf = (...execs: Parameters<typeof groupExecutions>[0]) => {
  const t = groupExecutions(execs).trades[0];
  if (!t) throw new Error('no trade');
  return t;
};

describe('summarizeTrade', () => {
  it('combines stats, risk, R, planned R:R and holding period', () => {
    const trade = tradeOf(
      fill('BUY', 100, '50', at(2), { id: 1, commission: '1' }),
      fill('SELL', 100, '55', at(4), { id: 2, commission: '1' }),
    );
    const s = summarizeTrade(trade, { initialStop: $('48'), target: $('56') });
    expect(s).toMatchObject({
      stableKey: 1,
      symbol: 'AAPL',
      direction: 'LONG',
      status: 'CLOSED',
      openedAt: at(2),
      closedAt: at(4),
      netPnl: $('498'),
      initialRisk: $('200'),
      plannedRewardRisk: 3,
      holding: { calendarDays: 2, tradingDays: 2 },
    });
    expect(s.rMultiple).toBeCloseTo(2.49, 10);
  });

  it('leaves R empty for a trade without a stop', () => {
    const trade = tradeOf(fill('BUY', 10, '50', at(2)), fill('SELL', 10, '51', at(3)));
    const s = summarizeTrade(trade);
    expect(s.initialRisk).toBeNull();
    expect(s.rMultiple).toBeNull();
    expect(s.plannedRewardRisk).toBeNull();
  });

  it('measures an open trade up to asOf (default: its last fill)', () => {
    const trade = tradeOf(fill('BUY', 10, '50', at(2)), fill('BUY', 10, '51', at(3)));
    expect(summarizeTrade(trade).holding).toEqual({ calendarDays: 1, tradingDays: 1 });
    expect(summarizeTrade(trade, {}, at(6)).holding).toEqual({ calendarDays: 4, tradingDays: 4 });
    expect(summarizeTrade(trade).netPnl).toBeNull();
    expect(summarizeTrade(trade).closedAt).toBeNull();
  });
});
