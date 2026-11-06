import { toMicros as $, toQuantity as sh } from '@tj/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTestApp, multipart, type TestApp } from '../__fixtures__/test-app';
import type { CsvMapping } from '../import/generic-csv';

const fixture = (name: string) =>
  readFileSync(new URL(`../import/__fixtures__/${name}`, import.meta.url));

async function preview(
  t: TestApp,
  file: Buffer,
  fields: Record<string, string>,
  filename = 'statement.csv',
) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/imports/preview',
    ...multipart(fields, { name: 'file', filename, contentType: 'text/csv', data: file }),
  });
  return { status: res.statusCode, body: res.json() };
}

const ibkr = (t: TestApp) => preview(t, fixture('ibkr-activity.csv'), { source: 'IBKR_ACTIVITY' });

/** Everything that defines the journal's state, minus bookkeeping timestamps. */
function snapshot(t: TestApp) {
  const q = (sql: string) => t.database.sqlite.prepare(sql).all();
  return {
    executions: q('SELECT * FROM executions ORDER BY id'),
    trades: q(
      'SELECT id, stable_key, symbol, status, opened_at, closed_at, initial_stop, thesis, orphaned_at FROM trades ORDER BY id',
    ),
    links: q('SELECT * FROM trade_executions ORDER BY trade_id, execution_id'),
    cashFlows: q('SELECT * FROM cash_flows ORDER BY id'),
  };
}

describe('IBKR Activity Statement import', () => {
  it('previews without writing anything', async () => {
    const t = createTestApp();
    const res = await ibkr(t);
    expect(res.status).toBe(200);
    expect(res.body.batch).toMatchObject({
      status: 'PREVIEW',
      source: 'IBKR_ACTIVITY',
      filename: 'statement.csv',
    });
    expect(res.body.summary).toEqual({
      executions: { new: 10, duplicate: 0, error: 0 },
      cashFlows: { new: 8, duplicate: 0 },
      skipped: 7,
      errors: 0,
      warnings: 0,
    });
    expect(res.body.canCommit).toBe(true);
    expect(res.body.duplicateOf).toBeNull();
    expect(res.body.trades.created.map((x: { symbol: string }) => x.symbol).sort()).toEqual([
      'BRK.B',
      'COST',
      'F',
      'MSFT',
      'NVDA',
    ]);
    expect(
      res.body.trades.created.find((x: { symbol: string }) => x.symbol === 'MSFT'),
    ).toMatchObject({
      status: 'CLOSED',
      fills: 3,
      netPnl: $('246.93'), // 6,300 − 6,050 − 3.05 commission − 0.02 fee
    });
    expect(snapshot(t).executions).toEqual([]);
    expect(snapshot(t).cashFlows).toEqual([]);
  });

  it('commits, then importing the same file again inserts 0 rows', async () => {
    const t = createTestApp();
    const p1 = await ibkr(t);
    const c1 = await t.post(`/api/imports/${p1.body.batch.id}/commit`, {});
    expect(c1.status).toBe(200);
    expect(c1.body).toMatchObject({
      status: 'COMMITTED',
      rowsInserted: 18,
      rowsSkippedDuplicate: 0,
    });
    expect((await t.get('/api/executions')).body.executions).toHaveLength(10);
    expect((await t.get('/api/cash-flows')).body.cashFlows).toHaveLength(8);
    const trades = (await t.get('/api/trades')).body.trades;
    expect(trades).toHaveLength(5);
    expect(
      (await t.get('/api/executions')).body.executions.every(
        (e: { source: string }) => e.source === 'IBKR_ACTIVITY',
      ),
    ).toBe(true);

    // Same file again: flagged as already imported, every row a duplicate.
    const p2 = await ibkr(t);
    expect(p2.body.duplicateOf).toMatchObject({ id: p1.body.batch.id });
    expect(p2.body.summary.executions).toEqual({ new: 0, duplicate: 10, error: 0 });
    expect(p2.body.summary.cashFlows).toEqual({ new: 0, duplicate: 8 });
    const refused = await t.post(`/api/imports/${p2.body.batch.id}/commit`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('DUPLICATE_FILE');
    const forced = await t.post(`/api/imports/${p2.body.batch.id}/commit`, { force: true });
    expect(forced.body).toMatchObject({
      status: 'COMMITTED',
      rowsInserted: 0,
      rowsSkippedDuplicate: 18,
    });
    expect((await t.get('/api/executions')).body.executions).toHaveLength(10);
  });

  it('undo restores the exact prior state', async () => {
    const t = createTestApp();
    // Prior state: a journaled manual MSFT trade (same symbol as the import) and a deposit.
    const m = await t.post('/api/trades', {
      symbol: 'MSFT',
      fill: {
        quantity: sh(3),
        price: $('390'),
        commission: $('1'),
        executedAt: '2026-01-05T15:00:00.000Z',
      },
      initialStop: $('380'),
      thesis: 'manual before import',
    });
    await t.post(`/api/trades/${m.body.id}/fills`, {
      side: 'SELL',
      quantity: sh(3),
      price: $('395'),
      executedAt: '2026-01-08T15:00:00.000Z',
    });
    await t.post('/api/cash-flows', {
      type: 'DEPOSIT',
      amount: $('5000'),
      occurredAt: '2026-01-02',
    });
    const before = snapshot(t);

    const p = await ibkr(t);
    await t.post(`/api/imports/${p.body.batch.id}/commit`, {});
    expect(snapshot(t)).not.toEqual(before);

    const undo = await t.post(`/api/imports/${p.body.batch.id}/undo`, {});
    expect(undo.status).toBe(200);
    expect(undo.body.status).toBe('UNDONE');
    expect(snapshot(t)).toEqual(before);
    expect((await t.post(`/api/imports/${p.body.batch.id}/undo`, {})).status).toBe(409);
  });

  it('refuses to undo when later fills depend on the imported ones', async () => {
    const t = createTestApp();
    const p = await ibkr(t);
    await t.post(`/api/imports/${p.body.batch.id}/commit`, {});
    // Manually close the imported open NVDA position.
    await t.post('/api/executions', {
      symbol: 'NVDA',
      side: 'SELL',
      quantity: sh(20),
      price: $('190'),
      executedAt: '2026-10-20T15:00:00.000Z',
    });
    const state = snapshot(t);
    const res = await t.post(`/api/imports/${p.body.batch.id}/undo`, {});
    expect(res.status).toBe(422);
    expect(snapshot(t)).toEqual(state);
  });

  it('rejects files that are not an Activity Statement', async () => {
    const t = createTestApp();
    const res = await preview(t, Buffer.from('a,b\n1,2\n'), { source: 'IBKR_ACTIVITY' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNREADABLE_FILE');
  });
});

const csvMapping: CsvMapping = {
  columns: {
    date: 'Date',
    time: 'Time',
    side: 'Action',
    symbol: 'Ticker',
    quantity: 'Shares',
    price: 'Price',
    commission: 'Fees',
    externalId: 'Trade ID',
  },
  dateFormat: 'MM/DD/YYYY',
  timeZone: 'America/New_York',
  sideValues: { buy: ['Bought'], sell: ['Sold'] },
};

describe('generic CSV import', () => {
  it('previews with a mapping, reporting skipped and error rows', async () => {
    const t = createTestApp();
    const res = await preview(t, fixture('generic.csv'), {
      source: 'CSV',
      mapping: JSON.stringify(csvMapping),
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      executions: { new: 5, duplicate: 0, error: 0 },
      skipped: 1,
      errors: 1,
    });
    expect(res.body.canCommit).toBe(true); // unreadable rows are listed, not imported
    const commit = await t.post(`/api/imports/${res.body.batch.id}/commit`, {});
    expect(commit.body).toMatchObject({ rowsInserted: 5 });
    expect(
      (await t.get('/api/trades')).body.trades.map((x: { symbol: string }) => x.symbol).sort(),
    ).toEqual(['AMD', 'BRK.B']);
  });

  it('blocks the commit when rows would break the long-only position', async () => {
    const t = createTestApp();
    const csv = Buffer.from(
      'Date,Time,Action,Ticker,Shares,Price,Fees,Trade ID\n03/02/2026,10:00,Sold,AMD,10,160,1,S-1\n',
    );
    const res = await preview(t, csv, { source: 'CSV', mapping: JSON.stringify(csvMapping) });
    expect(res.body.canCommit).toBe(false);
    expect(res.body.summary.executions).toEqual({ new: 0, duplicate: 0, error: 1 });
    expect(res.body.executions[0]).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/exceeds the open position/),
    });
    expect((await t.post(`/api/imports/${res.body.batch.id}/commit`, {})).status).toBe(422);
    expect(snapshot(t).executions).toEqual([]);
  });

  it('requires a valid mapping', async () => {
    const t = createTestApp();
    expect((await preview(t, fixture('generic.csv'), { source: 'CSV' })).status).toBe(400);
    expect(
      (await preview(t, fixture('generic.csv'), { source: 'CSV', mapping: '{"columns":{}}' }))
        .status,
    ).toBe(400);
    const wrongColumn = { ...csvMapping, columns: { ...csvMapping.columns, price: 'Cost' } };
    const res = await preview(t, fixture('generic.csv'), {
      source: 'CSV',
      mapping: JSON.stringify(wrongColumn),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/column "Cost" not found/);
  });

  it('can use a saved preset', async () => {
    const t = createTestApp();
    const preset = await t.post('/api/import-presets', { name: 'My broker', mapping: csvMapping });
    expect(preset.status).toBe(201);
    const res = await preview(t, fixture('generic.csv'), {
      source: 'CSV',
      presetId: String(preset.body.id),
    });
    expect(res.body.summary.executions.new).toBe(5);
  });
});

describe('import presets API', () => {
  it('creates, lists, updates and deletes presets', async () => {
    const t = createTestApp();
    const p = await t.post('/api/import-presets', { name: 'Broker A', mapping: csvMapping });
    expect(p.body).toMatchObject({ name: 'Broker A', mapping: csvMapping });
    expect(
      (await t.post('/api/import-presets', { name: 'Broker A', mapping: csvMapping })).status,
    ).toBe(409);
    expect(
      (await t.post('/api/import-presets', { name: 'Bad', mapping: { columns: {} } })).status,
    ).toBe(400);
    const upd = await t.put(`/api/import-presets/${p.body.id}`, {
      name: 'Broker B',
      mapping: { ...csvMapping, timeZone: 'UTC' },
    });
    expect(upd.body).toMatchObject({ name: 'Broker B', mapping: { timeZone: 'UTC' } });
    expect((await t.get('/api/import-presets')).body.presets).toHaveLength(1);
    expect((await t.del(`/api/import-presets/${p.body.id}`)).status).toBe(204);
    expect((await t.del(`/api/import-presets/${p.body.id}`)).status).toBe(404);
  });
});

describe('import history', () => {
  it('lists committed and undone imports, newest first, without previews', async () => {
    const t = createTestApp();
    const a = await ibkr(t);
    await t.post(`/api/imports/${a.body.batch.id}/commit`, {});
    await ibkr(t); // a preview that is never committed
    const list = (await t.get('/api/imports')).body.imports;
    expect(list).toEqual([
      expect.objectContaining({ id: a.body.batch.id, status: 'COMMITTED', rowsInserted: 18 }),
    ]);
    expect((await t.get(`/api/imports/${a.body.batch.id}`)).body).toMatchObject({
      id: a.body.batch.id,
      source: 'IBKR_ACTIVITY',
    });
    expect((await t.get('/api/imports/999')).status).toBe(404);
    expect((await t.post('/api/imports/999/commit', {})).status).toBe(404);
  });
});
