/**
 * Tests organised by ISTQB test design technique: boundary value analysis (3-value),
 * decision tables and state transitions. Each table row is one test case.
 */
import { toMicros as $, toQuantity as sh } from '@tj/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TINY_PNG, at, createTestApp, multipart, type TestApp } from '../__fixtures__/test-app';

async function trade(t: TestApp, over: Record<string, unknown> = {}) {
  return (
    await t.post('/api/trades', {
      symbol: 'AAPL',
      fill: { quantity: sh(10), price: $('50'), executedAt: at(2) },
      ...over,
    })
  ).body;
}

describe('Boundary value analysis (3-value)', () => {
  it.each([
    [0, 400],
    [1, 200],
    [2, 200],
    [4, 200],
    [5, 200],
    [6, 400],
  ])('execution rating %i -> HTTP %i (valid range 1..5)', async (rating, status) => {
    const t = createTestApp();
    const { id } = await trade(t);
    expect((await t.patch(`/api/trades/${id}`, { executionRating: rating })).status).toBe(status);
  });

  it.each([
    ['49.999999', 201], // just below the entry
    ['50', 400], // at the entry
    ['50.000001', 400], // just above
  ])('initial stop %s with a $50 entry -> HTTP %i', async (stop, status) => {
    const t = createTestApp();
    const res = await t.post('/api/trades', {
      symbol: 'AAPL',
      fill: { quantity: sh(10), price: $('50'), executedAt: at(2) },
      initialStop: $(stop),
    });
    expect(res.status).toBe(status);
  });

  it.each([
    [9, 201, 'OPEN'], // sell less than the position
    [10, 201, 'CLOSED'], // sell exactly the position
    [11, 422, 'OPEN'], // one share too many
  ])('selling %i of 10 shares -> HTTP %i, trade %s', async (qty, status, tradeStatus) => {
    const t = createTestApp();
    const { id } = await trade(t);
    const res = await t.post(`/api/trades/${id}/fills`, {
      side: 'SELL',
      quantity: sh(qty),
      price: $('51'),
      executedAt: at(3),
    });
    expect(res.status).toBe(status);
    expect((await t.get(`/api/trades/${id}`)).body.status).toBe(tradeStatus);
  });

  it.each([
    [0, 400],
    [1, 201], // one micro-share is the smallest quantity
    [2, 201],
  ])('fill quantity of %i micro-shares -> HTTP %i', async (q, status) => {
    const t = createTestApp();
    const res = await t.post('/api/executions', {
      symbol: 'AAPL',
      side: 'BUY',
      quantity: q,
      price: $('50'),
      executedAt: at(2),
    });
    expect(res.status).toBe(status);
  });

  it.each([
    ['ABCDEF', 201], // 6 characters: the maximum
    ['ABCDEFG', 400], // 7
    ['A', 201], // 1: the minimum
  ])('ticker %s -> HTTP %i', async (symbol, status) => {
    const t = createTestApp();
    const res = await t.post('/api/executions', {
      symbol,
      side: 'BUY',
      quantity: sh(1),
      price: $('1'),
      executedAt: at(2),
    });
    expect(res.status).toBe(status);
  });

  it.each([
    ['-0.999999', 'BREAKEVEN'],
    ['-1', 'LOSS'],
    ['0.999999', 'BREAKEVEN'],
    ['1', 'WIN'],
    ['1.000001', 'WIN'],
  ])('net P&L %s with a $1 break-even threshold -> %s', async (pnl, outcome) => {
    const t = createTestApp();
    // Buy 1 share at 100, sell at 100 + pnl, no fees.
    const { id } = await t
      .post('/api/trades', {
        symbol: 'AAPL',
        fill: { quantity: sh(1), price: $('100'), executedAt: at(2) },
      })
      .then((r) => r.body);
    await t.post(`/api/trades/${id}/fills`, {
      side: 'SELL',
      quantity: sh(1),
      price: $('100') + $(pnl),
      executedAt: at(3),
    });
    expect((await t.get(`/api/trades?status=CLOSED`)).body.trades[0].outcome).toBe(outcome);
  });

  it.each([
    [TINY_PNG.length - 1, 413], // limit just below the file size
    [TINY_PNG.length, 201], // exactly the file size
    [TINY_PNG.length + 1, 201],
  ])('upload limit %i bytes for a %i-byte file -> HTTP %i', async (limit, status) => {
    const t = createTestApp({ maxUploadBytes: limit });
    const { id } = await trade(t);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/trades/${id}/screenshots`,
      ...multipart(
        {},
        { name: 'file', filename: 'c.png', contentType: 'image/png', data: TINY_PNG },
      ),
    });
    expect(res.statusCode).toBe(status);
  });

  it.each([
    [9, 9],
    [10, 10],
    [11, 10],
  ])('after %i backups, %i are kept', async (n, kept) => {
    const t = createTestApp({ backups: true });
    for (let i = 0; i < n; i++) await t.post('/api/backups');
    expect((await t.get('/api/backups')).body.backups).toHaveLength(kept);
  });
});

describe('Decision table: initial risk', () => {
  // Conditions: planned-risk override set? | initial stop | -> risk used
  it.each([
    ['override, no stop', { plannedRiskOverride: $('300') }, $('300')],
    ['override and a stop', { plannedRiskOverride: $('300'), initialStop: $('48') }, $('300')],
    ['stop only', { initialStop: $('48') }, $('20')], // (50 − 48) × 10
    ['neither', {}, null],
  ])('%s -> risk %s', async (_label, plan, risk) => {
    const t = createTestApp();
    const { id } = await trade(t);
    const res = await t.patch(`/api/trades/${id}`, plan);
    expect(res.body.initialRisk).toBe(risk);
  });
});

describe('Decision table: cash-flow sign by type', () => {
  // type x sign of the amount -> accepted?
  it.each([
    ['DEPOSIT', '100', 201],
    ['DEPOSIT', '-100', 400],
    ['WITHDRAWAL', '-100', 201],
    ['WITHDRAWAL', '100', 400],
    ['DIVIDEND', '100', 201],
    ['DIVIDEND', '-100', 201], // withholding tax is booked as a negative dividend
    ['INTEREST', '-1', 201], // debit interest
    ['FEE', '-10', 201],
    ['FEE', '10', 201], // a fee refund
    ['FEE', '0', 400], // zero is never allowed
  ])('%s of %s -> HTTP %i', async (type, amount, status) => {
    const t = createTestApp();
    expect(
      (await t.post('/api/cash-flows', { type, amount: $(amount), occurredAt: '2026-03-02' }))
        .status,
    ).toBe(status);
  });
});

describe('State transitions: import batches', () => {
  const fixture = readFileSync(
    new URL('../import/__fixtures__/ibkr-activity.csv', import.meta.url),
  );
  async function previewBatch(t: TestApp) {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/imports/preview',
      ...multipart(
        { source: 'IBKR_ACTIVITY' },
        { name: 'file', filename: 's.csv', contentType: 'text/csv', data: fixture },
      ),
    });
    return res.json().batch.id as number;
  }

  // From state x event -> resulting status / HTTP code
  it('PREVIEW --undo--> refused (409), stays PREVIEW', async () => {
    const t = createTestApp();
    const id = await previewBatch(t);
    const res = await t.post(`/api/imports/${id}/undo`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_COMMITTED');
    expect((await t.get(`/api/imports/${id}`)).body.status).toBe('PREVIEW');
  });

  it('PREVIEW --commit--> COMMITTED --commit--> refused (409)', async () => {
    const t = createTestApp();
    const id = await previewBatch(t);
    expect((await t.post(`/api/imports/${id}/commit`, {})).body.status).toBe('COMMITTED');
    const again = await t.post(`/api/imports/${id}/commit`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOT_A_PREVIEW');
  });

  it('COMMITTED --undo--> UNDONE --commit / undo--> refused (409)', async () => {
    const t = createTestApp();
    const id = await previewBatch(t);
    await t.post(`/api/imports/${id}/commit`, {});
    expect((await t.post(`/api/imports/${id}/undo`, {})).body.status).toBe('UNDONE');
    expect((await t.post(`/api/imports/${id}/commit`, {})).status).toBe(409);
    expect((await t.post(`/api/imports/${id}/undo`, {})).status).toBe(409);
    expect((await t.get(`/api/imports/${id}`)).body.status).toBe('UNDONE');
  });
});

describe('Requests without a body', () => {
  it('treat an empty PATCH/PUT as "no change" and an empty restore as unconfirmed', async () => {
    const t = createTestApp({ backups: true });
    const { id, executions } = await trade(t);
    const cf = (
      await t.post('/api/cash-flows', { type: 'DEPOSIT', amount: $('1'), occurredAt: '2026-03-02' })
    ).body;
    const tag = (await t.post('/api/tags', { name: 'X', kind: 'CUSTOM' })).body;
    const noBody = (method: 'PATCH' | 'PUT' | 'POST', url: string) =>
      t.app.inject({ method, url }).then((r) => r.statusCode);
    expect(await noBody('PATCH', `/api/executions/${executions[0].id}`)).toBe(200);
    expect(await noBody('PATCH', `/api/trades/${id}`)).toBe(200);
    expect(await noBody('PATCH', `/api/cash-flows/${cf.id}`)).toBe(200);
    expect(await noBody('PATCH', `/api/tags/${tag.id}`)).toBe(200);
    expect(await noBody('PUT', '/api/settings')).toBe(200);
    expect(await noBody('POST', '/api/market-data/sync')).toBe(200);
    const backup = (await t.post('/api/backups')).body.name as string;
    expect(await noBody('POST', `/api/backups/${backup}/restore`)).toBe(400);
  });
});
