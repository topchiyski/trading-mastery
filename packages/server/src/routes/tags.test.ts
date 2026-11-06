import { toMicros as $, toQuantity as sh } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { at, createTestApp, type TestApp } from '../__fixtures__/test-app';

async function trade(t: TestApp, symbol: string, setupTagId?: number) {
  return (
    await t.post('/api/trades', {
      symbol,
      fill: { quantity: sh(10), price: $('10'), executedAt: at(2) },
      ...(setupTagId ? { setupTagId } : {}),
    })
  ).body.id as number;
}

describe('tags API', () => {
  it('creates, lists (optionally by kind) and recolours/renames tags', async () => {
    const t = createTestApp();
    const res = await t.post('/api/tags', { name: 'Breakout', kind: 'SETUP', color: '#22c55e' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Breakout', kind: 'SETUP', color: '#22c55e' });
    await t.post('/api/tags', { name: 'Chased', kind: 'MISTAKE' });

    expect((await t.get('/api/tags')).body.tags).toHaveLength(2);
    expect(
      (await t.get('/api/tags?kind=MISTAKE')).body.tags.map((x: { name: string }) => x.name),
    ).toEqual(['Chased']);

    const upd = await t.patch(`/api/tags/${res.body.id}`, {
      name: 'Base breakout',
      color: '#000000',
    });
    expect(upd.body).toMatchObject({ name: 'Base breakout', color: '#000000', kind: 'SETUP' });
  });

  it('rejects duplicates and bad input', async () => {
    const t = createTestApp();
    await t.post('/api/tags', { name: 'Breakout', kind: 'SETUP' });
    expect((await t.post('/api/tags', { name: 'Breakout', kind: 'MISTAKE' })).status).toBe(409);
    expect((await t.post('/api/tags', { name: '  ', kind: 'SETUP' })).status).toBe(400);
    expect((await t.post('/api/tags', { name: 'X', kind: 'OTHER' })).status).toBe(400);
    expect((await t.post('/api/tags', { name: 'Y', kind: 'SETUP', color: 'red' })).status).toBe(
      400,
    );
    expect((await t.patch('/api/tags/999', { name: 'Z' })).status).toBe(404);
  });

  it('deletes a tag, clearing it from trades', async () => {
    const t = createTestApp();
    const setup = (await t.post('/api/tags', { name: 'Breakout', kind: 'SETUP' })).body.id;
    const id = await trade(t, 'AAPL', setup);
    expect((await t.del(`/api/tags/${setup}`)).status).toBe(204);
    expect((await t.get(`/api/trades/${id}`)).body.setupTag).toBeNull();
    expect((await t.del(`/api/tags/${setup}`)).status).toBe(404);
  });

  it('deletes with reassignment / merges into another tag of the same kind', async () => {
    const t = createTestApp();
    const a = (await t.post('/api/tags', { name: 'Breakout', kind: 'SETUP' })).body.id;
    const b = (await t.post('/api/tags', { name: 'Base', kind: 'SETUP' })).body.id;
    const m1 = (await t.post('/api/tags', { name: 'Chased', kind: 'MISTAKE' })).body.id;
    const m2 = (await t.post('/api/tags', { name: 'FOMO', kind: 'MISTAKE' })).body.id;
    const t1 = await trade(t, 'AAPL', a);
    const t2 = await trade(t, 'MSFT');
    await t.put(`/api/trades/${t2}/tags`, { tagIds: [m1, m2] }); // has both: merge must not duplicate

    expect((await t.del(`/api/tags/${a}?reassignTo=${b}`)).status).toBe(204);
    expect((await t.get(`/api/trades/${t1}`)).body.setupTag.name).toBe('Base');

    const merged = await t.post(`/api/tags/${m1}/merge`, { intoId: m2 });
    expect(merged.status).toBe(200);
    expect(
      (await t.get(`/api/trades/${t2}`)).body.tags.map((x: { name: string }) => x.name),
    ).toEqual(['FOMO']);

    expect((await t.del(`/api/tags/${b}?reassignTo=${m2}`)).status).toBe(400); // kind mismatch
    expect((await t.post(`/api/tags/${m2}/merge`, { intoId: m2 })).status).toBe(400); // into itself
    expect((await t.post(`/api/tags/${m2}/merge`, { intoId: 999 })).status).toBe(404);
  });
});
