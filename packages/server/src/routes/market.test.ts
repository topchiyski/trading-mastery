import { excursions, notional, toMicros as $, toQuantity as sh } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { MockProvider, mockMarket } from '../__fixtures__/market';
import { createTestApp, type TestApp } from '../__fixtures__/test-app';

const ts = (date: string, hhmm = '15:00') => `${date}T${hhmm}:00.000Z`;

async function trade(
  t: TestApp,
  symbol: string,
  buy: { date: string; qty: number; price: string },
  sell?: { date: string; price: string },
  stop?: string,
) {
  const res = await t.post('/api/trades', {
    symbol,
    fill: { quantity: sh(buy.qty), price: $(buy.price), executedAt: ts(buy.date) },
    ...(stop ? { initialStop: $(stop) } : {}),
  });
  if (sell) {
    await t.post(`/api/trades/${res.body.id}/fills`, {
      side: 'SELL',
      quantity: sh(buy.qty),
      price: $(sell.price),
      executedAt: ts(sell.date, '19:00'),
    });
  }
  return res.body.id as number;
}

describe('GET /api/trades/:id/chart', () => {
  it('returns cached daily candles around the trade, fill markers, stops and MAE/MFE', async () => {
    const provider = new MockProvider();
    const t = createTestApp({ market: mockMarket(provider) });
    const id = await trade(
      t,
      'AAPL',
      { date: '2026-03-02', qty: 100, price: '50' },
      { date: '2026-03-04', price: '55' },
      '48',
    );
    await t.post(`/api/trades/${id}/stops`, {
      stopPrice: $('51'),
      changedAt: ts('2026-03-03', '21:00'),
    });

    const res = await t.get(`/api/trades/${id}/chart`);
    expect(res.status).toBe(200);
    const c = res.body;
    // 30 calendar days before entry to 10 after exit (capped at the last complete day)
    expect(c.from).toBe('2026-01-31');
    expect(c.to).toBe('2026-03-13');
    expect(c.candles[0].date).toBe('2026-02-02');
    expect(c.candles.at(-1).date).toBe('2026-03-13');
    expect(c.complete).toBe(true);
    expect(c.markers).toEqual([
      { date: '2026-03-02', side: 'BUY', price: $('50'), quantity: sh(100) },
      { date: '2026-03-04', side: 'SELL', price: $('55'), quantity: sh(100) },
    ]);
    expect(c.levels).toMatchObject({ initialStop: $('48'), currentStop: $('51'), target: null });

    // MAE/MFE over the trade's own bars (entry date .. exit date), per the core rules.
    const own = c.candles.filter(
      (b: { date: string }) => b.date >= '2026-03-02' && b.date <= '2026-03-04',
    );
    expect(c.excursions).toEqual(
      excursions({ avgEntry: $('50'), quantity: sh(100), initialRisk: $('200'), bars: own }),
    );

    provider.calls = [];
    await t.get(`/api/trades/${id}/chart`);
    expect(provider.calls).toEqual([]); // cached
  });

  it('degrades gracefully without a provider', async () => {
    const t = createTestApp();
    const id = await trade(t, 'AAPL', { date: '2026-03-02', qty: 1, price: '50' });
    const res = await t.get(`/api/trades/${id}/chart`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ candles: [], complete: false, excursions: null });
    expect(res.body.note).toMatch(/not configured/i);
  });

  it('flags a split during the trade', async () => {
    const provider = new MockProvider();
    provider.patch = (_s, bars) =>
      bars.map((b) => (b.date === '2026-03-03' ? { ...b, splitFactor: 4 } : b));
    const t = createTestApp({ market: mockMarket(provider) });
    const id = await trade(
      t,
      'AAPL',
      { date: '2026-03-02', qty: 1, price: '50' },
      { date: '2026-03-05', price: '51' },
    );
    const res = await t.get(`/api/trades/${id}/chart`);
    expect(res.body.splits).toEqual([{ date: '2026-03-03', ratio: 4, source: 'provider' }]);
  });

  it('404s for an unknown trade', async () => {
    const t = createTestApp();
    expect((await t.get('/api/trades/999/chart')).status).toBe(404);
  });
});

describe('GET /api/positions', () => {
  it('values open positions at the last close, with unrealised P&L, stop distance and open risk', async () => {
    const provider = new MockProvider();
    const t = createTestApp({ market: mockMarket(provider) });
    await t.put('/api/settings', { startingBalance: $('10000'), startDate: '2026-03-02' });
    const id = await trade(
      t,
      'NVDA',
      { date: '2026-03-09', qty: 10, price: '100' },
      undefined,
      '90',
    );
    await trade(
      t,
      'AAPL',
      { date: '2026-03-02', qty: 1, price: '50' },
      { date: '2026-03-04', price: '60' },
    ); // closed: not listed

    const last = (await provider.getDailyCandles('NVDA', '2026-03-13', '2026-03-13'))[0]!;
    const res = await t.get('/api/positions');
    expect(res.status).toBe(200);
    expect(res.body.asOf).toBe('2026-03-13');
    expect(res.body.positions).toHaveLength(1);
    const p = res.body.positions[0];
    const value = notional(sh(10), last.close);
    expect(p).toMatchObject({
      tradeId: id,
      symbol: 'NVDA',
      shares: sh(10),
      avgCost: $('100'),
      lastClose: last.close,
      lastCloseDate: '2026-03-13',
      marketValue: value,
      unrealised: value - $('1000'),
      currentStop: $('90'),
      openRisk: notional(sh(10), last.close - $('90')),
      initialRisk: $('100'),
    });
    expect(p.unrealisedPct).toBeCloseTo((value - $('1000')) / $('1000'), 12);
    expect(p.unrealisedR).toBeCloseTo((value - $('1000')) / $('100'), 12);
    expect(p.stopDistancePct).toBeCloseTo((last.close - $('90')) / last.close, 12);
    expect(p.stopDistanceR).toBeCloseTo(notional(sh(10), last.close - $('90')) / $('100'), 12);

    // Equity = 10,000 + closed AAPL +10 + unrealised NVDA
    const equity = $('10010') + p.unrealised;
    expect(res.body.totals).toMatchObject({
      openRisk: p.openRisk,
      unrealised: p.unrealised,
      equity,
    });
    expect(res.body.totals.openRiskPctOfEquity).toBeCloseTo(p.openRisk / equity, 12);
  });

  it('lists positions without prices when there is no market data', async () => {
    const t = createTestApp();
    await trade(t, 'NVDA', { date: '2026-03-09', qty: 10, price: '100' });
    const p = (await t.get('/api/positions')).body.positions[0];
    expect(p).toMatchObject({ symbol: 'NVDA', lastClose: null, unrealised: null, openRisk: null });
  });
});

describe('market data sync and status', () => {
  it('backfills every traded symbol plus SPY, respecting the rate limit', async () => {
    const provider = new MockProvider();
    const t = createTestApp({ market: mockMarket(provider, 2) });
    await t.put('/api/settings', { startDate: '2026-03-02' });
    await trade(
      t,
      'AAPL',
      { date: '2026-03-02', qty: 1, price: '50' },
      { date: '2026-03-04', price: '51' },
    );
    await trade(t, 'MSFT', { date: '2026-03-05', qty: 1, price: '400' });

    const before = (await t.get('/api/market-data/status')).body;
    expect(before).toMatchObject({ configured: true, provider: 'mock', pendingSymbols: 3 });

    const run = await t.post('/api/market-data/sync', { wait: true });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ pendingSymbols: 1, lastError: { kind: 'rate-limited' } });
    expect(provider.calls.map((c) => c[0]).sort()).toEqual(['AAPL', 'MSFT']);
    expect(run.body.usage).toEqual([{ label: 'hour', used: 2, max: 2 }]);
  });

  it('reports "not configured" without a provider', async () => {
    const t = createTestApp();
    expect((await t.get('/api/market-data/status')).body).toMatchObject({
      configured: false,
      provider: null,
    });
    expect((await t.post('/api/market-data/sync', { wait: true })).body.lastError).toMatchObject({
      kind: 'not-configured',
    });
  });
});

describe('dashboard market additions', () => {
  it('adds the SPY benchmark and per-trade MAE/MFE from cached candles', async () => {
    const provider = new MockProvider();
    const t = createTestApp({ market: mockMarket(provider) });
    await t.put('/api/settings', { startingBalance: $('10000'), startDate: '2026-03-02' });
    await trade(
      t,
      'AAPL',
      { date: '2026-03-02', qty: 10, price: '50' },
      { date: '2026-03-04', price: '55' },
      '48',
    );

    // Before any sync: nothing cached, the dashboard says so instead of fetching.
    const d0 = (await t.get('/api/dashboard?to=2026-03-13')).body;
    expect(d0.benchmark).toBeNull();
    expect(d0.trades[0].mae).toBeNull();
    expect(provider.calls).toEqual([]);

    await t.post('/api/market-data/sync', { wait: true });
    const d = (await t.get('/api/dashboard?to=2026-03-13')).body;
    expect(d.benchmark.symbol).toBe('SPY');
    expect(d.benchmark.points).toHaveLength(d.equity.length);
    expect(d.benchmark.points[0]).toMatchObject({ date: '2026-03-02', spy: 100, portfolio: 100 });
    expect(d.trades[0].mae).toEqual(expect.objectContaining({ r: expect.any(Number) }));
    expect(d.trades[0].mfe.r).toBeGreaterThanOrEqual(0);
  });
});

describe('backfill planning', () => {
  it('covers the whole benchmark period for SPY even when SPY was also traded', async () => {
    const provider = new MockProvider();
    const t = createTestApp({ market: mockMarket(provider) });
    await t.put('/api/settings', { startDate: '2026-01-05' });
    await trade(
      t,
      'SPY',
      { date: '2026-03-02', qty: 1, price: '600' },
      { date: '2026-03-03', price: '601' },
    );
    await t.post('/api/market-data/sync', { wait: true });
    const spy = provider.calls.filter((c) => c[0] === 'SPY');
    expect(spy).toEqual([['SPY', '2026-01-05', '2026-03-13']]);
  });
});
