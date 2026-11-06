import { toMicros as $, toQuantity as sh } from '@tj/core';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TINY_PNG, createTestApp, multipart, type TestApp } from '../__fixtures__/test-app';

const TABLES = [
  'executions',
  'trades',
  'trade_executions',
  'stop_changes',
  'tags',
  'trade_tags',
  'screenshots',
  'cash_flows',
  'import_batches',
  'import_presets',
  'candles',
  'candle_coverage',
  'settings',
  'sqlite_sequence',
];

function snapshot(t: TestApp) {
  return Object.fromEntries(
    TABLES.map((name) => [
      name,
      t.database.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY 1, 2`).all(),
    ]),
  );
}

async function richData(t: TestApp) {
  await t.put('/api/settings', { startingBalance: $('25000'), startDate: '2026-01-02' });
  const tag = (await t.post('/api/tags', { name: 'Chased', kind: 'MISTAKE' })).body.id;
  const trade = await t.post('/api/trades', {
    symbol: 'AAPL',
    fill: { quantity: sh(10), price: $('50'), executedAt: '2026-03-02T15:00:00.000Z' },
    initialStop: $('48'),
    thesis: 'base breakout',
  });
  const id = trade.body.id as number;
  await t.put(`/api/trades/${id}/tags`, { tagIds: [tag] });
  await t.post(`/api/trades/${id}/stops`, {
    stopPrice: $('49'),
    changedAt: '2026-03-03T21:00:00.000Z',
  });
  await t.post('/api/cash-flows', { type: 'DEPOSIT', amount: $('5000'), occurredAt: '2026-03-01' });
  const shot = await t.app.inject({
    method: 'POST',
    url: `/api/trades/${id}/screenshots`,
    ...multipart(
      { caption: 'chart' },
      { name: 'file', filename: 'c.png', contentType: 'image/png', data: TINY_PNG },
    ),
  });
  return { tradeId: id, screenshot: shot.json() as { id: number; url: string; filePath: string } };
}

describe('backups', () => {
  it('backup -> wipe -> restore round-trips the database and the screenshots exactly', async () => {
    const t = createTestApp({ backups: true });
    const { screenshot } = await richData(t);
    const before = snapshot(t);

    const backup = await t.post('/api/backups');
    expect(backup.status).toBe(201);
    expect(backup.body.name).toMatch(/^journal-\d{8}-\d{4}(-\d+)?$/);
    expect(backup.body.dbBytes).toBeGreaterThan(0);
    expect(backup.body.uploadsBytes).toBeGreaterThan(0);

    // Wipe everything, then add something that must not survive the restore.
    t.database.sqlite.pragma('foreign_keys = OFF');
    for (const name of TABLES) t.database.sqlite.prepare(`DELETE FROM "${name}"`).run();
    t.database.sqlite.pragma('foreign_keys = ON');
    rmSync(join(t.uploadsDir, screenshot.filePath));
    await t.post('/api/trades', {
      symbol: 'MSFT',
      fill: { quantity: sh(1), price: $('400'), executedAt: '2026-04-01T15:00:00.000Z' },
    });
    expect((await t.get(screenshot.url)).status).toBe(404);

    const restore = await t.post(`/api/backups/${backup.body.name}/restore`, { confirm: true });
    expect(restore.status).toBe(200);
    expect(restore.body.restored).toBe(backup.body.name);
    expect(restore.body.safetyBackup).toMatch(/^journal-/);

    expect(snapshot(t)).toEqual(before);
    const file = await t.app.inject({ method: 'GET', url: screenshot.url });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(TINY_PNG)).toBe(true);
    expect(t.database.sqlite.pragma('foreign_key_check')).toEqual([]);

    // The pre-restore state was saved first, so the restore itself can be undone.
    const names = (await t.get('/api/backups')).body.backups.map((b: { name: string }) => b.name);
    expect(names).toContain(restore.body.safetyBackup);
  });

  it('keeps only the 10 most recent backups, newest first', async () => {
    const t = createTestApp({ backups: true });
    for (let i = 0; i < 12; i++) expect((await t.post('/api/backups')).status).toBe(201);
    const list = (await t.get('/api/backups')).body.backups as { name: string }[];
    expect(list).toHaveLength(10);
    expect([...list.map((b) => b.name)].sort().reverse()).toEqual(list.map((b) => b.name));
    const files = readdirSync(t.backupsDir!);
    expect(files.filter((f) => f.endsWith('.db'))).toHaveLength(10);
    expect(files.filter((f) => f.endsWith('-uploads.zip'))).toHaveLength(10);
  });

  it('requires confirmation and rejects unknown or unsafe names', async () => {
    const t = createTestApp({ backups: true });
    const b = await t.post('/api/backups');
    expect((await t.post(`/api/backups/${b.body.name}/restore`, {})).status).toBe(400);
    expect(
      (await t.post('/api/backups/journal-20990101-0000/restore', { confirm: true })).status,
    ).toBe(404);
    expect((await t.post('/api/backups/..%2F..%2Fetc/restore', { confirm: true })).status).toBe(
      400,
    );
  });

  it('downloads a backup database file', async () => {
    const t = createTestApp({ backups: true });
    const b = await t.post('/api/backups');
    const res = await t.app.inject({ method: 'GET', url: `/api/backups/${b.body.name}/download` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain(`${b.body.name}.db`);
    expect(res.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(existsSync(join(t.backupsDir!, `${b.body.name}.db`))).toBe(true);
  });
});
