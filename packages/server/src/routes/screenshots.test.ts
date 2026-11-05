import { toMicros as $ } from '@tj/core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TINY_PNG, at, createTestApp, multipart, type TestApp } from '../__fixtures__/test-app';

async function newTrade(t: TestApp) {
  return (
    await t.post('/api/trades', {
      symbol: 'AAPL',
      fill: { quantity: 10, price: $('50'), executedAt: at(2) },
    })
  ).body.id as number;
}

async function upload(t: TestApp, tradeId: number, data = TINY_PNG, caption = 'Daily chart') {
  const body = multipart(
    { caption },
    { name: 'file', filename: 'chart.png', contentType: 'image/png', data },
  );
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/trades/${tradeId}/screenshots`,
    ...body,
  });
  return { status: res.statusCode, body: res.json() };
}

describe('screenshots API', () => {
  it('uploads an image, stores it under the uploads dir and serves it back', async () => {
    const t = createTestApp();
    const id = await newTrade(t);
    const res = await upload(t, id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tradeId: id,
      caption: 'Daily chart',
      url: `/api/screenshots/${res.body.id}/file`,
    });
    expect(res.body.filePath).toMatch(new RegExp(`^${id}/[0-9a-f-]+\\.png$`));
    expect(existsSync(join(t.uploadsDir, res.body.filePath))).toBe(true);

    const file = await t.app.inject({ method: 'GET', url: res.body.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.rawPayload.equals(TINY_PNG)).toBe(true);

    const detail = await t.get(`/api/trades/${id}`);
    expect(detail.body.screenshots).toEqual([
      expect.objectContaining({ id: res.body.id, url: res.body.url }),
    ]);
  });

  it('rejects files that are not PNG/JPEG/WebP/GIF by content', async () => {
    const t = createTestApp();
    const id = await newTrade(t);
    const res = await upload(t, id, Buffer.from('<script>alert(1)</script>'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE');
    expect(readdirSync(t.uploadsDir)).toEqual([]);
  });

  it('rejects oversized files with 413', async () => {
    const t = createTestApp({ maxUploadBytes: 50 });
    const id = await newTrade(t);
    const res = await upload(t, id, Buffer.concat([TINY_PNG, Buffer.alloc(100)]));
    expect(res.status).toBe(413);
  });

  it('rejects a request without a file', async () => {
    const t = createTestApp();
    const id = await newTrade(t);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/trades/${id}/screenshots`,
      ...multipart({ caption: 'x' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('updates the caption and deletes the screenshot with its file', async () => {
    const t = createTestApp();
    const id = await newTrade(t);
    const shot = (await upload(t, id)).body;
    const upd = await t.patch(`/api/screenshots/${shot.id}`, { caption: 'Weekly' });
    expect(upd.body.caption).toBe('Weekly');

    expect((await t.del(`/api/screenshots/${shot.id}`)).status).toBe(204);
    expect(existsSync(join(t.uploadsDir, shot.filePath))).toBe(false);
    expect((await t.get(shot.url)).status).toBe(404);
    expect((await t.del(`/api/screenshots/${shot.id}`)).status).toBe(404);
  });

  it('returns 404 for an unknown trade', async () => {
    const t = createTestApp();
    expect((await upload(t, 999)).status).toBe(404);
  });

  it('removes the files when an orphaned journal entry is deleted', async () => {
    const t = createTestApp();
    const exec = await t.post('/api/executions', {
      symbol: 'MSFT',
      side: 'BUY',
      quantity: 1,
      price: $('10'),
      executedAt: at(2),
    });
    const shot = (await upload(t, exec.body.tradeId)).body;
    await t.del(`/api/executions/${exec.body.execution.id}`); // screenshot keeps the row as an orphan
    expect((await t.del(`/api/trades/${exec.body.tradeId}`)).status).toBe(204);
    expect(existsSync(join(t.uploadsDir, shot.filePath))).toBe(false);
  });
});
