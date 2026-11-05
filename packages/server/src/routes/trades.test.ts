import { toMicros as $ } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { at, createTestApp, type TestApp } from '../__fixtures__/test-app';

const newTrade = (overrides: Record<string, unknown> = {}) => ({
  symbol: 'AAPL',
  fill: { quantity: 100, price: $('50'), commission: $('1'), executedAt: at(2) },
  initialStop: $('48'),
  target: $('56'),
  thesis: 'Breakout over 49.80 on volume',
  ...overrides,
});

async function setupTag(t: TestApp, name: string, kind = 'SETUP') {
  return (await t.post('/api/tags', { name, kind })).body.id as number;
}

describe('POST /api/trades (new trade)', () => {
  it('creates the first fill and the journal entry in one go', async () => {
    const t = createTestApp();
    const setupId = await setupTag(t, 'Breakout');
    const res = await t.post('/api/trades', newTrade({ setupTagId: setupId }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      symbol: 'AAPL',
      direction: 'LONG',
      status: 'OPEN',
      orphaned: false,
      openQty: 100,
      avgEntry: $('50'),
      initialRisk: $('200'),
      plannedRewardRisk: 3,
      currentStop: $('48'),
      setupTag: { id: setupId, name: 'Breakout' },
      journal: { initialStop: $('48'), target: $('56'), thesis: 'Breakout over 49.80 on volume' },
    });
    expect(res.body.executions).toHaveLength(1);
    expect(res.body.stableKey).toBe(res.body.executions[0].id);
  });

  it('refuses a new trade while a position in the symbol is open', async () => {
    const t = createTestApp();
    await t.post('/api/trades', newTrade());
    const res = await t.post(
      '/api/trades',
      newTrade({ fill: { quantity: 10, price: $('51'), executedAt: at(3) } }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POSITION_ALREADY_OPEN');
    expect((await t.get('/api/executions')).body.executions).toHaveLength(1);
  });

  it('validates the stop is below the entry and the setup tag is a SETUP tag', async () => {
    const t = createTestApp();
    expect((await t.post('/api/trades', newTrade({ initialStop: $('51') }))).status).toBe(400);
    const mistake = await setupTag(t, 'Chased', 'MISTAKE');
    expect((await t.post('/api/trades', newTrade({ setupTagId: mistake }))).status).toBe(400);
    expect((await t.post('/api/trades', newTrade({ setupTagId: 999 }))).status).toBe(400);
  });
});

describe('POST /api/trades/:id/fills (add fill)', () => {
  it('adds scale-ins and scale-outs and closes the trade', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    await t.post(`/api/trades/${id}/fills`, {
      side: 'BUY',
      quantity: 100,
      price: $('52'),
      executedAt: at(3),
    });
    await t.post(`/api/trades/${id}/fills`, {
      side: 'SELL',
      quantity: 120,
      price: $('55'),
      commission: $('1'),
      executedAt: at(4),
    });
    const res = await t.post(`/api/trades/${id}/fills`, {
      side: 'SELL',
      quantity: 80,
      price: $('54'),
      commission: $('1'),
      executedAt: at(5),
    });
    expect(res.status).toBe(201);
    // Buys 5,000 + 5,200 = 10,200. Sells 6,600 + 4,320 = 10,920. Gross 720, fees 3, net 717.
    expect(res.body).toMatchObject({
      id,
      status: 'CLOSED',
      quantity: 200,
      avgEntry: $('51'),
      netPnl: $('717'),
      closedAt: at(5),
    });
    expect(res.body.rMultiple).toBeCloseTo(717 / 200, 10);
    expect(res.body.realisations).toHaveLength(2);
  });

  it('rejects a fill that would land outside this trade', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    await t.post(`/api/trades/${id}/fills`, {
      side: 'SELL',
      quantity: 100,
      price: $('55'),
      executedAt: at(4),
    });
    // A buy after the close would start a new trade.
    const res = await t.post(`/api/trades/${id}/fills`, {
      side: 'BUY',
      quantity: 10,
      price: $('55'),
      executedAt: at(9),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FILL_OUTSIDE_TRADE');
    expect((await t.get('/api/executions')).body.executions).toHaveLength(2);
  });

  it('rejects an oversized sell with 422', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    const res = await t.post(`/api/trades/${id}/fills`, {
      side: 'SELL',
      quantity: 101,
      price: $('55'),
      executedAt: at(4),
    });
    expect(res.status).toBe(422);
  });

  it('returns 404 for an unknown trade', async () => {
    const t = createTestApp();
    const res = await t.post('/api/trades/999/fills', {
      side: 'BUY',
      quantity: 1,
      price: $('1'),
      executedAt: at(2),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/trades/:id (journal)', () => {
  it('updates journal fields, including clearing them with null', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    const res = await t.patch(`/api/trades/${id}`, {
      review: 'Sold into strength, good',
      emotion: 'calm',
      executionRating: 4,
      followedPlan: true,
      plannedRiskOverride: $('300'),
      target: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.journal).toMatchObject({
      review: 'Sold into strength, good',
      emotion: 'calm',
      executionRating: 4,
      followedPlan: true,
      plannedRiskOverride: $('300'),
      target: null,
      thesis: 'Breakout over 49.80 on volume',
    });
    expect(res.body.initialRisk).toBe($('300'));
  });

  it('validates rating range and unknown fields', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    expect((await t.patch(`/api/trades/${id}`, { executionRating: 6 })).status).toBe(400);
    expect((await t.patch(`/api/trades/${id}`, { symbol: 'MSFT' })).status).toBe(400);
    expect((await t.patch('/api/trades/999', { review: 'x' })).status).toBe(404);
  });
});

describe('GET /api/trades (list, filters, totals)', () => {
  async function seed(t: TestApp) {
    const breakout = await setupTag(t, 'Breakout');
    const chased = await setupTag(t, 'Chased', 'MISTAKE');
    // AAPL win: +498
    const a = (await t.post('/api/trades', newTrade({ setupTagId: breakout }))).body;
    await t.post(`/api/trades/${a.id}/fills`, {
      side: 'SELL',
      quantity: 100,
      price: $('55'),
      commission: $('1'),
      executedAt: at(4),
    });
    // MSFT loss: −202, no stop
    const m = (
      await t.post(
        '/api/trades',
        newTrade({
          symbol: 'MSFT',
          initialStop: null,
          fill: { quantity: 200, price: $('20'), commission: $('1'), executedAt: at(5) },
        }),
      )
    ).body;
    await t.post(`/api/trades/${m.id}/fills`, {
      side: 'SELL',
      quantity: 200,
      price: $('19'),
      commission: $('1'),
      executedAt: at(9),
    });
    await t.put(`/api/trades/${m.id}/tags`, { tagIds: [chased] });
    // NVDA open
    await t.post(
      '/api/trades',
      newTrade({
        symbol: 'NVDA',
        fill: { quantity: 10, price: $('100'), executedAt: at(10) },
        initialStop: $('95'),
      }),
    );
    return { breakout, chased };
  }

  it('lists trades newest first with derived columns and totals for closed trades', async () => {
    const t = createTestApp();
    await seed(t);
    const res = await t.get('/api/trades');
    expect(res.status).toBe(200);
    expect(res.body.trades.map((x: { symbol: string }) => x.symbol)).toEqual([
      'NVDA',
      'MSFT',
      'AAPL',
    ]);
    const aapl = res.body.trades[2];
    expect(aapl).toMatchObject({
      status: 'CLOSED',
      quantity: 100,
      avgEntry: $('50'),
      avgExit: $('55'),
      netPnl: $('498'),
      holding: { calendarDays: 2, tradingDays: 2 },
      setupTag: { name: 'Breakout' },
    });
    expect(aapl.returnPct).toBeCloseTo(0.0996, 10);
    expect(aapl.rMultiple).toBeCloseTo(2.49, 10);
    expect(res.body.totals).toMatchObject({
      count: 3,
      closedCount: 2,
      openCount: 1,
      netPnl: $('296'),
      fees: $('4'),
      wins: 1,
      losses: 1,
      rExcludedCount: 1,
    });
  });

  it('filters by status, symbol, setup, tag, outcome and date range', async () => {
    const t = createTestApp();
    const { breakout, chased } = await seed(t);
    const symbols = async (q: string) =>
      (await t.get(`/api/trades?${q}`)).body.trades.map((x: { symbol: string }) => x.symbol);
    expect(await symbols('status=OPEN')).toEqual(['NVDA']);
    expect(await symbols('symbol=msft')).toEqual(['MSFT']);
    expect(await symbols(`setupTagId=${breakout}`)).toEqual(['AAPL']);
    expect(await symbols(`tagId=${chased}`)).toEqual(['MSFT']);
    expect(await symbols('outcome=WIN')).toEqual(['AAPL']);
    expect(await symbols('outcome=LOSS')).toEqual(['MSFT']);
    // Date range applies to the close date (open date for open trades), NY dates, inclusive.
    expect(await symbols('from=2026-03-05&to=2026-03-09')).toEqual(['MSFT']);
    expect(await symbols('from=2026-03-10')).toEqual(['NVDA']);
    expect((await t.get('/api/trades?status=NOPE')).status).toBe(400);
  });
});

describe('trade tags', () => {
  it('replaces the tag set and rejects SETUP tags there', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    const a = await setupTag(t, 'Chased', 'MISTAKE');
    const b = await setupTag(t, 'Earnings', 'CUSTOM');
    const setup = await setupTag(t, 'Breakout');
    expect(
      (await t.put(`/api/trades/${id}/tags`, { tagIds: [a, b] })).body.tags.map(
        (x: { name: string }) => x.name,
      ),
    ).toEqual(['Chased', 'Earnings']);
    expect((await t.put(`/api/trades/${id}/tags`, { tagIds: [b] })).body.tags).toHaveLength(1);
    expect((await t.put(`/api/trades/${id}/tags`, { tagIds: [setup] })).status).toBe(400);
  });
});

describe('stop history', () => {
  it('records trailing stops; the latest becomes the current stop', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    const s1 = await t.post(`/api/trades/${id}/stops`, { stopPrice: $('50'), changedAt: at(4) });
    expect(s1.status).toBe(201);
    await t.post(`/api/trades/${id}/stops`, { stopPrice: $('49'), changedAt: at(3) });
    const list = await t.get(`/api/trades/${id}/stops`);
    expect(list.body.stops.map((s: { stopPrice: number }) => s.stopPrice)).toEqual([
      $('49'),
      $('50'),
    ]);
    const detail = await t.get(`/api/trades/${id}`);
    expect(detail.body.currentStop).toBe($('50'));
    expect(detail.body.initialRisk).toBe($('200')); // trailing stops don't change initial risk

    expect((await t.del(`/api/stops/${s1.body.id}`)).status).toBe(204);
    expect((await t.get(`/api/trades/${id}`)).body.currentStop).toBe($('49'));
    expect((await t.del(`/api/stops/${s1.body.id}`)).status).toBe(404);
  });

  it('defaults changedAt to now and validates the price', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    const res = await t.post(`/api/trades/${id}/stops`, { stopPrice: $('49') });
    expect(Date.parse(res.body.changedAt)).not.toBeNaN();
    expect((await t.post(`/api/trades/${id}/stops`, { stopPrice: 0 })).status).toBe(400);
    expect((await t.post('/api/trades/999/stops', { stopPrice: $('1') })).status).toBe(404);
  });
});

describe('DELETE /api/trades/:id', () => {
  it('only deletes orphaned journal entries', async () => {
    const t = createTestApp();
    const { id } = (await t.post('/api/trades', newTrade())).body;
    expect((await t.del(`/api/trades/${id}`)).status).toBe(409);
    expect((await t.del('/api/trades/999')).status).toBe(404);
  });
});
