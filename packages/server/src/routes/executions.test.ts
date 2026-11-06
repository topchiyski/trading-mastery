import { toMicros as $, toQuantity as sh } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { at, createTestApp } from '../__fixtures__/test-app';

const buy = (overrides: Record<string, unknown> = {}) => ({
  symbol: 'AAPL',
  side: 'BUY',
  quantity: sh(100),
  price: $('50'),
  commission: $('1'),
  executedAt: at(2),
  ...overrides,
});

describe('executions API', () => {
  it('creates a manual execution, groups it into a trade and lists it', async () => {
    const t = createTestApp();
    const res = await t.post('/api/executions', buy());
    expect(res.status).toBe(201);
    expect(res.body.execution).toMatchObject({
      symbol: 'AAPL',
      side: 'BUY',
      quantity: sh(100),
      price: 50_000_000,
      commission: 1_000_000,
      otherFees: 0,
      source: 'MANUAL',
      executedAt: '2026-03-02T15:00:00.000Z',
    });
    expect(res.body.tradeId).toEqual(expect.any(Number));

    const list = await t.get('/api/executions');
    expect(list.status).toBe(200);
    expect(list.body.executions).toHaveLength(1);
  });

  it('normalises timestamps with offsets to UTC', async () => {
    const t = createTestApp();
    const res = await t.post('/api/executions', buy({ executedAt: '2026-03-02T10:00:00-05:00' }));
    expect(res.body.execution.executedAt).toBe('2026-03-02T15:00:00.000Z');
  });

  it('filters the list by symbol and sorts chronologically', async () => {
    const t = createTestApp();
    await t.post('/api/executions', buy({ executedAt: at(3) }));
    await t.post('/api/executions', buy({ executedAt: at(2) }));
    await t.post('/api/executions', buy({ symbol: 'MSFT' }));
    const res = await t.get('/api/executions?symbol=AAPL');
    expect(res.body.executions.map((e: { executedAt: string }) => e.executedAt)).toEqual([
      at(2),
      at(3),
    ]);
  });

  it('rejects invalid input with 400', async () => {
    const t = createTestApp();
    for (const bad of [
      buy({ symbol: 'aapl' }),
      buy({ quantity: 0 }),
      buy({ quantity: 1.5 }),
      buy({ price: -1 }),
      buy({ price: 1.5 }),
      buy({ commission: -1 }),
      buy({ side: 'SHORT' }),
      buy({ executedAt: 'yesterday' }),
    ]) {
      const res = await t.post('/api/executions', bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects a sell that exceeds the position with 422 and saves nothing', async () => {
    const t = createTestApp();
    await t.post('/api/executions', buy());
    const res = await t.post(
      '/api/executions',
      buy({ side: 'SELL', quantity: sh(150), executedAt: at(3) }),
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SELL_EXCEEDS_POSITION');
    expect(res.body.error.details.errors[0]).toMatchObject({
      positionBefore: sh(100),
      sellQuantity: sh(150),
    });
    expect((await t.get('/api/executions')).body.executions).toHaveLength(1);
  });

  it('rejects a duplicate broker execution id with 409', async () => {
    const t = createTestApp();
    await t.post('/api/executions', buy({ externalId: 'X1' }));
    const res = await t.post('/api/executions', buy({ externalId: 'X1', executedAt: at(3) }));
    expect(res.status).toBe(409);
  });

  it('updates an execution and regroups', async () => {
    const t = createTestApp();
    const b = await t.post('/api/executions', buy());
    const s = await t.post(
      '/api/executions',
      buy({ side: 'SELL', quantity: sh(40), executedAt: at(3) }),
    );
    const res = await t.patch(`/api/executions/${s.body.execution.id}`, { quantity: sh(100) });
    expect(res.status).toBe(200);
    expect(res.body.execution.quantity).toBe(sh(100));
    const trade = await t.get(`/api/trades/${b.body.tradeId}`);
    expect(trade.body.status).toBe('CLOSED');
  });

  it('refuses an update that would break the position, keeping the old values', async () => {
    const t = createTestApp();
    await t.post('/api/executions', buy());
    const s = await t.post(
      '/api/executions',
      buy({ side: 'SELL', quantity: sh(40), executedAt: at(3) }),
    );
    const res = await t.patch(`/api/executions/${s.body.execution.id}`, { quantity: sh(500) });
    expect(res.status).toBe(422);
    const list = await t.get('/api/executions');
    expect(list.body.executions[1].quantity).toBe(sh(40));
  });

  it('regroups both symbols when the symbol changes', async () => {
    const t = createTestApp();
    const b = await t.post('/api/executions', buy());
    await t.patch(`/api/executions/${b.body.execution.id}`, { symbol: 'MSFT' });
    const trades = await t.get('/api/trades');
    expect(trades.body.trades.map((x: { symbol: string }) => x.symbol)).toEqual(['MSFT']);
  });

  it('deletes an execution and regroups', async () => {
    const t = createTestApp();
    await t.post('/api/executions', buy());
    const s = await t.post('/api/executions', buy({ side: 'SELL', executedAt: at(3) }));
    expect((await t.del(`/api/executions/${s.body.execution.id}`)).status).toBe(204);
    const trades = await t.get('/api/trades');
    expect(trades.body.trades[0].status).toBe('OPEN');
  });

  it('refuses to delete a buy that later sells depend on', async () => {
    const t = createTestApp();
    const b = await t.post('/api/executions', buy());
    await t.post('/api/executions', buy({ side: 'SELL', executedAt: at(3) }));
    const res = await t.del(`/api/executions/${b.body.execution.id}`);
    expect(res.status).toBe(422);
  });

  it('returns 404 for unknown executions', async () => {
    const t = createTestApp();
    expect((await t.patch('/api/executions/999', { quantity: sh(1) })).status).toBe(404);
    expect((await t.del('/api/executions/999')).status).toBe(404);
    expect((await t.del('/api/executions/abc')).status).toBe(400);
  });
});
