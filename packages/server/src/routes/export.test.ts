import { parseCsv, toMicros as $, toQuantity as sh } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../__fixtures__/test-app';

async function csv(t: TestApp, url: string) {
  const res = await t.app.inject({ method: 'GET', url });
  return { status: res.statusCode, headers: res.headers, rows: parseCsv(res.body) };
}

const asObjects = (rows: string[][]) => {
  const [head = [], ...data] = rows;
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
};

async function seed(t: TestApp) {
  const setup = (await t.post('/api/tags', { name: 'Breakout', kind: 'SETUP' })).body.id;
  const mistake = (await t.post('/api/tags', { name: 'Chased', kind: 'MISTAKE' })).body.id;
  const a = await t.post('/api/trades', {
    symbol: 'AAPL',
    fill: {
      quantity: sh(100),
      price: $('50'),
      commission: $('1'),
      executedAt: '2026-03-02T15:00:00.000Z',
    },
    initialStop: $('48'),
    setupTagId: setup,
    thesis: '=HYPERLINK("http://evil")',
  });
  await t.post(`/api/trades/${a.body.id}/fills`, {
    side: 'SELL',
    quantity: sh(100),
    price: $('55'),
    commission: $('1'),
    executedAt: '2026-03-04T19:00:00.000Z',
  });
  await t.put(`/api/trades/${a.body.id}/tags`, { tagIds: [mistake] });
  await t.post('/api/trades', {
    symbol: 'MSFT',
    fill: { quantity: sh('0.5'), price: $('400.125'), executedAt: '2026-03-05T15:00:00.000Z' },
  });
  await t.post('/api/cash-flows', {
    type: 'DEPOSIT',
    amount: $('10000'),
    occurredAt: '2026-03-01',
    note: 'Funding',
  });
  await t.post('/api/cash-flows', {
    type: 'DIVIDEND',
    amount: $('1.23'),
    occurredAt: '2026-04-01',
  });
  return { aId: a.body.id as number };
}

describe('CSV exports', () => {
  it('exports trades with derived metrics as a downloadable CSV', async () => {
    const t = createTestApp();
    const { aId } = await seed(t);
    const res = await csv(t, '/api/export/trades.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="trades-\d{8}\.csv"$/,
    );
    const rows = asObjects(res.rows);
    expect(rows).toHaveLength(2);
    const aapl = rows.find((r) => r['symbol'] === 'AAPL');
    expect(aapl).toMatchObject({
      id: String(aId),
      status: 'CLOSED',
      opened_at: '2026-03-02T15:00:00.000Z',
      closed_at: '2026-03-04T19:00:00.000Z',
      trading_days: '2',
      shares: '100',
      avg_entry: '50.00',
      avg_exit: '55.00',
      gross_pnl: '500.00',
      fees: '2.00',
      net_pnl: '498.00',
      return_pct: '9.96',
      initial_stop: '48.00',
      initial_risk: '200.00',
      r_multiple: '2.49',
      setup: 'Breakout',
      tags: 'Chased',
      outcome: 'WIN',
    });
    // Formula injection is neutralised.
    expect(aapl?.['thesis']).toBe(`'=HYPERLINK("http://evil")`);
    const msft = rows.find((r) => r['symbol'] === 'MSFT');
    expect(msft).toMatchObject({
      status: 'OPEN',
      shares: '0.5',
      avg_entry: '400.125',
      net_pnl: '',
    });
  });

  it('applies the trade-list filters', async () => {
    const t = createTestApp();
    await seed(t);
    const rows = asObjects((await csv(t, '/api/export/trades.csv?symbol=MSFT')).rows);
    expect(rows.map((r) => r['symbol'])).toEqual(['MSFT']);
    expect(asObjects((await csv(t, '/api/export/trades.csv?status=CLOSED')).rows)).toHaveLength(1);
  });

  it('exports executions with plain share and dollar amounts', async () => {
    const t = createTestApp();
    await seed(t);
    const rows = asObjects((await csv(t, '/api/export/executions.csv')).rows);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      executed_at: '2026-03-02T15:00:00.000Z',
      symbol: 'AAPL',
      side: 'BUY',
      quantity: '100',
      price: '50.00',
      commission: '1.00',
      other_fees: '0.00',
      source: 'MANUAL',
    });
    expect(rows[2]).toMatchObject({ symbol: 'MSFT', quantity: '0.5', price: '400.125' });
    expect(asObjects((await csv(t, '/api/export/executions.csv?symbol=MSFT')).rows)).toHaveLength(
      1,
    );
  });

  it('exports cash flows, optionally by date range', async () => {
    const t = createTestApp();
    await seed(t);
    const all = asObjects((await csv(t, '/api/export/cash-flows.csv')).rows);
    expect(all).toEqual([
      expect.objectContaining({
        occurred_at: '2026-03-01',
        type: 'DEPOSIT',
        amount: '10000.00',
        note: 'Funding',
      }),
      expect.objectContaining({ occurred_at: '2026-04-01', type: 'DIVIDEND', amount: '1.23' }),
    ]);
    expect(
      asObjects((await csv(t, '/api/export/cash-flows.csv?from=2026-03-15')).rows),
    ).toHaveLength(1);
  });

  it('rejects invalid filters', async () => {
    const t = createTestApp();
    expect((await t.get('/api/export/trades.csv?status=NOPE')).status).toBe(400);
  });
});
