import { describe, expect, it } from 'vitest';
import { at, fill } from './__fixtures__/fill';
import { toMicros as $ } from './money';
import { computeTradeStats, holdingPeriod } from './trade-stats';

describe('computeTradeStats — hand-calculated cases', () => {
  it('single entry and exit, win', () => {
    // Buy 100 @ 50.00, sell 100 @ 55.00, $1 commission each side.
    // Gross = 5,500 − 5,000 = 500; fees = 2; net = 498; return = 498 / 5,000 = 9.96%.
    const s = computeTradeStats([
      fill('BUY', 100, '50', at(2), { commission: '1' }),
      fill('SELL', 100, '55', at(4), { commission: '1' }),
    ]);
    expect(s.status).toBe('CLOSED');
    expect(s.grossPnl).toBe($('500'));
    expect(s.fees).toBe($('2'));
    expect(s.netPnl).toBe($('498'));
    expect(s.returnPct).toBeCloseTo(0.0996, 10);
    expect(s.avgEntry).toBe($('50'));
    expect(s.avgExit).toBe($('55'));
    expect(s.firstEntry).toEqual({ price: $('50'), quantity: 100, executedAt: at(2) });
  });

  it('single entry and exit, loss', () => {
    // Buy 200 @ 20, sell 200 @ 19, $1 each side. Gross −200, net −202, return −202/4,000 = −5.05%.
    const s = computeTradeStats([
      fill('BUY', 200, '20', at(2), { commission: '1' }),
      fill('SELL', 200, '19', at(3), { commission: '1' }),
    ]);
    expect(s.grossPnl).toBe($('-200'));
    expect(s.netPnl).toBe($('-202'));
    expect(s.returnPct).toBeCloseTo(-0.0505, 10);
  });

  it('scale-in with 3 fills then a single exit', () => {
    // Buys: 100@10 + 100@11 + 200@12 = 1,000 + 1,100 + 2,400 = 4,500 for 400 sh -> avg 11.25.
    // Sell 400 @ 13 = 5,200. Gross = 700. Fees 0.50 × 3 + 1 = 2.50. Net = 697.50.
    const s = computeTradeStats([
      fill('BUY', 100, '10', at(2), { commission: '0.5' }),
      fill('BUY', 100, '11', at(3), { commission: '0.5' }),
      fill('BUY', 200, '12', at(4), { commission: '0.5' }),
      fill('SELL', 400, '13', at(5), { commission: '1' }),
    ]);
    expect(s.buyCost).toBe($('4500'));
    expect(s.sellProceeds).toBe($('5200'));
    expect(s.avgEntry).toBe($('11.25'));
    expect(s.avgExit).toBe($('13'));
    expect(s.grossPnl).toBe($('700'));
    expect(s.fees).toBe($('2.5'));
    expect(s.netPnl).toBe($('697.5'));
    expect(s.firstEntry.quantity).toBe(100);
  });

  it('single entry then 3 scale-outs, realised P&L per exit on average cost', () => {
    // Buy 300 @ 40 (cost 12,000, avg 40). Sell 100@42 -> +200, 100@44 -> +400, 100@38 -> −200.
    // Gross = 400. Avg exit = 12,400 / 300 = 41.333333. Fees 1 × 4 = 4. Net = 396.
    const s = computeTradeStats([
      fill('BUY', 300, '40', at(2), { commission: '1' }),
      fill('SELL', 100, '42', at(3), { commission: '1' }),
      fill('SELL', 100, '44', at(4), { commission: '1' }),
      fill('SELL', 100, '38', at(5), { commission: '1' }),
    ]);
    expect(s.realisations.map((r) => r.realisedGross)).toEqual([$('200'), $('400'), $('-200')]);
    expect(s.grossPnl).toBe($('400'));
    expect(s.realisedGross).toBe($('400'));
    expect(s.avgExit).toBe(41_333_333);
    expect(s.netPnl).toBe($('396'));
  });

  it('interleaved scale-in and scale-out uses the average cost at the time of each sell', () => {
    // Buy 100@10 (avg 10). Sell 50@12 -> +100 (cost removed 500).
    // Buy 50@14 -> 100 sh, cost 500 + 700 = 1,200, avg 12. Sell 100@13 -> +100.
    // Gross = (600 + 1,300) − (1,000 + 700) = 200 = 100 + 100.
    const s = computeTradeStats([
      fill('BUY', 100, '10', at(2)),
      fill('SELL', 50, '12', at(3)),
      fill('BUY', 50, '14', at(4)),
      fill('SELL', 100, '13', at(5)),
    ]);
    expect(s.realisations.map((r) => r.realisedGross)).toEqual([$('100'), $('100')]);
    expect(s.realisations.map((r) => r.costBasisRemoved)).toEqual([$('500'), $('1200')]);
    expect(s.grossPnl).toBe($('200'));
    expect(s.avgEntry).toBe(11_333_333); // 1,700 / 150
    expect(s.avgExit).toBe(12_666_667); // 1,900 / 150
  });

  it('fees turn a gross win into a net loss', () => {
    // Buy 10 @ 100, sell 10 @ 100.20 -> gross +2.00. Commission 1.50 + fees 0.50 per side = 4.00.
    const s = computeTradeStats([
      fill('BUY', 10, '100', at(2), { commission: '1.5', otherFees: '0.5' }),
      fill('SELL', 10, '100.20', at(3), { commission: '1.5', otherFees: '0.5' }),
    ]);
    expect(s.grossPnl).toBe($('2'));
    expect(s.commissions).toBe($('3'));
    expect(s.otherFees).toBe($('1'));
    expect(s.netPnl).toBe($('-2'));
  });

  it('reports an open trade with realised P&L on the partial exit only', () => {
    // Buy 300 @ 40, sell 100 @ 42 -> realised +200; 200 sh remain at avg cost 40.
    const s = computeTradeStats([
      fill('BUY', 300, '40', at(2), { commission: '1' }),
      fill('SELL', 100, '42', at(3), { commission: '1' }),
    ]);
    expect(s.status).toBe('OPEN');
    expect(s.openQty).toBe(200);
    expect(s.openCostBasis).toBe($('8000'));
    expect(s.avgOpenCost).toBe($('40'));
    expect(s.realisedGross).toBe($('200'));
    expect(s.realisedNet).toBe($('198')); // all fees so far are charged against realised P&L
    expect(s.grossPnl).toBeNull();
    expect(s.netPnl).toBeNull();
    expect(s.returnPct).toBeNull();
  });

  it('has no average exit before any sell', () => {
    const s = computeTradeStats([fill('BUY', 10, '5', at(2))]);
    expect(s.avgExit).toBeNull();
  });

  it('sorts executions itself', () => {
    const s = computeTradeStats([fill('SELL', 10, '6', at(3)), fill('BUY', 10, '5', at(2))]);
    expect(s.netPnl).toBe($('10'));
  });

  it('rejects empty input and oversized sells', () => {
    expect(() => computeTradeStats([])).toThrow(RangeError);
    expect(() =>
      computeTradeStats([fill('BUY', 10, '5', at(2)), fill('SELL', 11, '6', at(3))]),
    ).toThrow(RangeError);
  });
});

describe('holdingPeriod', () => {
  it('counts calendar and trading days between New York dates', () => {
    expect(holdingPeriod(at(6), at(9))).toEqual({ calendarDays: 3, tradingDays: 1 }); // Fri -> Mon
    expect(holdingPeriod(at(2), at(2, 30))).toEqual({ calendarDays: 0, tradingDays: 0 });
  });

  it('uses NY dates, not UTC dates', () => {
    // 2026-03-06T03:00Z is still Mar 5 in New York.
    expect(holdingPeriod('2026-03-06T03:00:00Z', at(6))).toEqual({
      calendarDays: 1,
      tradingDays: 1,
    });
  });
});
