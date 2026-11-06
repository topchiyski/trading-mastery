import { toMicros as $, toQuantity as sh } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../__fixtures__/test-app';
import { listTrades } from '../repo/trades';
import { seedDemo } from '../seed/demo';

const ts = (day: number, hhmm = '15:00') =>
  `2026-03-${String(day).padStart(2, '0')}T${hhmm}:00.000Z`;

async function trade(
  t: TestApp,
  symbol: string,
  buy: [qty: number, price: string, day: number],
  sell: [price: string, day: number],
  extra: Record<string, unknown> = {},
) {
  const created = await t.post('/api/trades', {
    symbol,
    fill: { quantity: sh(buy[0]), price: $(buy[1]), executedAt: ts(buy[2]) },
    ...extra,
  });
  await t.post(`/api/trades/${created.body.id}/fills`, {
    side: 'SELL',
    quantity: sh(buy[0]),
    price: $(sell[0]),
    executedAt: ts(sell[1], '19:00'),
  });
  return created.body.id as number;
}

/**
 * Start 10,000 on Mon Mar 2.
 * A  AAPL 100 @ 50 (Mar 2) -> 55 (Mar 4): +500, stop 48 -> risk 200 -> +2.5R, Breakout
 * B  MSFT  10 @ 400 (Mar 5) -> 380 (Mar 9): -200, stop 390 -> risk 100 -> -2R, Pullback, "Chased"
 *    Deposit 5,000 on Fri Mar 6
 * C  AAPL  50 @ 60 (Mar 10) -> 64 (Mar 11): +200, no stop
 */
async function setup(t: TestApp) {
  await t.put('/api/settings', { startingBalance: $('10000'), startDate: '2026-03-02' });
  const breakout = (await t.post('/api/tags', { name: 'Breakout', kind: 'SETUP' })).body.id;
  const pullback = (await t.post('/api/tags', { name: 'Pullback', kind: 'SETUP' })).body.id;
  const chased = (await t.post('/api/tags', { name: 'Chased', kind: 'MISTAKE' })).body.id;
  await trade(t, 'AAPL', [100, '50', 2], ['55', 4], { initialStop: $('48'), setupTagId: breakout });
  const b = await trade(t, 'MSFT', [10, '400', 5], ['380', 9], {
    initialStop: $('390'),
    setupTagId: pullback,
  });
  await t.put(`/api/trades/${b}/tags`, { tagIds: [chased] });
  await t.post('/api/cash-flows', { type: 'DEPOSIT', amount: $('5000'), occurredAt: '2026-03-06' });
  await trade(t, 'AAPL', [50, '60', 10], ['64', 11]);
  return { breakout, pullback, chased };
}

describe('GET /api/dashboard — hand-calculated', () => {
  it('computes the KPIs', async () => {
    const t = createTestApp();
    await setup(t);
    const d = (await t.get('/api/dashboard?to=2026-03-13')).body;
    expect(d.metrics).toMatchObject({
      count: 3,
      wins: 2,
      losses: 1,
      totalNetPnl: $('500'),
      profitFactor: 3.5, // 700 / 200
      rTradeCount: 2,
      rExcludedCount: 1,
    });
    expect(d.metrics.winRate).toBeCloseTo(2 / 3, 12);
    expect(d.metrics.expectancyR).toBeCloseTo(0.25, 12); // (2.5 − 2) / 2
    expect(d.metrics.maxDrawdown).toBe($('-200')); // performance 500 -> 300 at worst... peak 500, trough 300
    expect(d.metrics.maxDrawdownPct).toBeCloseTo(-200 / 15500, 12); // MSFT loss on 15,500 equity
  });

  it('builds the equity curve over trading days, with the deposit not counted as return', async () => {
    const t = createTestApp();
    await setup(t);
    const d = (await t.get('/api/dashboard?to=2026-03-13')).body;
    expect(d.equity.map((p: { date: string; equity: number }) => [p.date, p.equity / 1e6])).toEqual(
      [
        ['2026-03-02', 10000],
        ['2026-03-03', 10000],
        ['2026-03-04', 10500],
        ['2026-03-05', 10500],
        ['2026-03-06', 15500],
        ['2026-03-09', 15300],
        ['2026-03-10', 15300],
        ['2026-03-11', 15500],
        ['2026-03-12', 15500],
        ['2026-03-13', 15500],
      ],
    );
    const last = d.equity.at(-1);
    expect(last.twrIndex).toBeCloseTo(1.05 * (1 - 200 / 15500) * (1 + 200 / 15300), 12);
    expect(d.includesCashFlows).toBe(true);
  });

  it('returns the R curve, monthly cells, trade points and breakdowns', async () => {
    const t = createTestApp();
    await setup(t);
    const d = (await t.get('/api/dashboard?to=2026-03-13')).body;
    expect(d.rCurve.excluded).toBe(1);
    expect(d.rCurve.points.map((p: { cumR: number }) => p.cumR)).toEqual([2.5, 0.5]);
    expect(d.monthly).toEqual([{ month: '2026-03', netPnl: $('500'), count: 3 }]);
    expect(d.trades).toHaveLength(3);
    expect(d.trades[0]).toMatchObject({
      symbol: 'AAPL',
      netPnl: $('500'),
      rMultiple: 2.5,
      tradingDays: 2,
    });

    const rows = (k: string) =>
      d.breakdowns[k].map((r: { key: string; count: number; totalNetPnl: number }) => [
        r.key,
        r.count,
        r.totalNetPnl / 1e6,
      ]);
    expect(rows('setup')).toEqual([
      ['(no setup)', 1, 200],
      ['Breakout', 1, 500],
      ['Pullback', 1, -200],
    ]);
    expect(rows('symbol')).toEqual([
      ['AAPL', 2, 700],
      ['MSFT', 1, -200],
    ]);
    expect(rows('mistake')).toEqual([['Chased', 1, -200]]); // cost of mistakes
    expect(rows('weekday')).toEqual([
      ['Mon', 1, 500],
      ['Tue', 1, 200],
      ['Thu', 1, -200],
    ]);
    expect(rows('month')).toEqual([['2026-03', 3, 500]]);
  });
});

describe('GET /api/dashboard — filters', () => {
  it('a symbol filter narrows every figure and leaves cash flows out of the equity curve', async () => {
    const t = createTestApp();
    await setup(t);
    const d = (await t.get('/api/dashboard?to=2026-03-13&symbol=aapl')).body;
    expect(d.metrics).toMatchObject({ count: 2, totalNetPnl: $('700') });
    expect(d.includesCashFlows).toBe(false);
    expect(d.equity.at(-1).equity).toBe($('10700'));
  });

  it('a setup or mistake filter selects matching trades', async () => {
    const t = createTestApp();
    const { pullback, chased } = await setup(t);
    expect(
      (await t.get(`/api/dashboard?to=2026-03-13&setupTagId=${pullback}`)).body.metrics.count,
    ).toBe(1);
    expect(
      (await t.get(`/api/dashboard?to=2026-03-13&tagId=${chased}`)).body.metrics.totalNetPnl,
    ).toBe($('-200'));
  });

  it('a date range starts the curve at the balance on that day', async () => {
    const t = createTestApp();
    await setup(t);
    const d = (await t.get('/api/dashboard?from=2026-03-05&to=2026-03-13')).body;
    expect(d.metrics.count).toBe(2); // closed Mar 9 and Mar 11
    expect(d.equity[0]).toMatchObject({ date: '2026-03-05', equity: $('10500') });
    expect(d.equity[0].twrIndex).toBe(1);
  });

  it('is empty, not an error, without data', async () => {
    const t = createTestApp();
    const d = (await t.get('/api/dashboard')).body;
    expect(d.metrics.count).toBe(0);
    expect(d.equity).toEqual([]);
    expect(d.monthly).toEqual([]);
  });

  it('validates query parameters', async () => {
    const t = createTestApp();
    expect((await t.get('/api/dashboard?from=2026-13-01')).status).toBe(400);
    expect((await t.get('/api/dashboard?setupTagId=x')).status).toBe(400);
  });
});

describe('GET /api/dashboard — demo seed', () => {
  it('agrees with the trade list and its own parts', async () => {
    const t = createTestApp();
    seedDemo(t.database.db);
    const d = (await t.get('/api/dashboard?to=2026-11-06')).body;
    const closed = listTrades(t.database.db, { status: 'CLOSED' }).trades;
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

    expect(d.metrics.count).toBe(closed.length);
    expect(d.metrics.totalNetPnl).toBe(sum(closed.map((x) => x.netPnl ?? 0)));
    expect(sum(d.monthly.map((m: { netPnl: number }) => m.netPnl))).toBe(d.metrics.totalNetPnl);
    expect(sum(d.monthly.map((m: { count: number }) => m.count))).toBe(d.metrics.count);
    for (const key of ['setup', 'symbol', 'weekday', 'month']) {
      expect(sum(d.breakdowns[key].map((r: { totalNetPnl: number }) => r.totalNetPnl))).toBe(
        d.metrics.totalNetPnl,
      );
    }
    const last = d.equity.at(-1);
    // equity = starting balance + all cash flows + realised P&L
    expect(last.equity).toBe(
      $('25000') + last.externalFlowsCum + last.incomeCum + d.metrics.totalNetPnl,
    );
    expect(d.metrics.maxDrawdown).toBe(
      Math.min(...d.equity.map((p: { performanceDrawdown: number }) => p.performanceDrawdown)),
    );

    // Pinned figures of the deterministic demo data set (cross-checked by the assertions above).
    expect(d.metrics).toMatchObject(PINNED);
  });
});

// The demo data set is deterministic; these were checked against the independent sums above
// and by hand (18 + 22 + 1 = 41; win rate 18/40; the largest loss is the SMCI edge case, −1,000 − $2 fees).
const PINNED = {
  count: 41,
  wins: 18,
  losses: 22,
  breakEvens: 1,
  winRate: 0.45,
  totalNetPnl: $('8970.73'),
  grossWins: $('13577.06'),
  grossLosses: $('-4606.33'),
  largestWin: $('2986'),
  largestLoss: $('-1002'),
  longestWinStreak: 5,
  longestLossStreak: 10,
  totalFees: $('100.58'),
  maxDrawdown: $('-1719.06'),
  rTradeCount: 39,
  rExcludedCount: 2,
};
