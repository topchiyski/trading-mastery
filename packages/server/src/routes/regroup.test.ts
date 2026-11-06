import { toMicros as $, toQuantity as sh } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { at, createTestApp } from '../__fixtures__/test-app';

const fill = (side: 'BUY' | 'SELL', quantity: number, price: string, executedAt: string) => ({
  symbol: 'AAPL',
  side,
  quantity: sh(quantity),
  price: $(price),
  executedAt,
});

describe('regrouping keeps journal data attached', () => {
  it('journal notes survive an earlier-dated fill being inserted', async () => {
    const t = createTestApp();
    // Trade: buy Mar 5, sell Mar 9. Journal it.
    const b = await t.post('/api/executions', fill('BUY', 100, '50', at(5)));
    await t.post('/api/executions', fill('SELL', 100, '55', at(9)));
    const tradeId = b.body.tradeId as number;
    const tag = (await t.post('/api/tags', { name: 'Chased', kind: 'MISTAKE' })).body.id;
    await t.patch(`/api/trades/${tradeId}`, { thesis: 'Base breakout', initialStop: $('48') });
    await t.put(`/api/trades/${tradeId}/tags`, { tagIds: [tag] });
    await t.post(`/api/trades/${tradeId}/stops`, { stopPrice: $('52'), changedAt: at(6) });

    // An import brings in an earlier buy (Mar 3) that belongs to the same position.
    const early = await t.post('/api/executions', fill('BUY', 50, '49', at(3)));
    await t.patch(`/api/executions/${early.body.execution.id}`, {}); // no-op update still regroups
    // Make the position balance again: sell the extra 50.
    await t.post('/api/executions', fill('SELL', 50, '56', at(10)));

    const list = (await t.get('/api/trades')).body.trades;
    expect(list).toHaveLength(1);
    const trade = (await t.get(`/api/trades/${list[0].id}`)).body;
    // Same trade row, re-keyed to the new first execution, journal intact.
    expect(trade.id).toBe(tradeId);
    expect(trade.stableKey).toBe(early.body.execution.id);
    expect(trade.openedAt).toBe(at(3));
    expect(trade.status).toBe('CLOSED');
    expect(trade.journal.thesis).toBe('Base breakout');
    expect(trade.tags.map((x: { name: string }) => x.name)).toEqual(['Chased']);
    expect(trade.stops).toHaveLength(1);
    expect(trade.orphaned).toBe(false);
    expect(trade.executions).toHaveLength(4);
  });

  it('flags (never deletes) journal data orphaned by a merge, and un-flags it if the split returns', async () => {
    const t = createTestApp();
    // Two separate trades: A (Mar 2–3) and B (Mar 5–6), both journaled.
    const a = await t.post('/api/executions', fill('BUY', 100, '10', at(2)));
    const aSell = await t.post('/api/executions', fill('SELL', 100, '11', at(3)));
    const b = await t.post('/api/executions', fill('BUY', 100, '12', at(5)));
    await t.post('/api/executions', fill('SELL', 100, '13', at(6)));
    await t.patch(`/api/trades/${a.body.tradeId}`, { thesis: 'A notes' });
    await t.patch(`/api/trades/${b.body.tradeId}`, { thesis: 'B notes' });

    // Editing A's sell down to 40 shares keeps the position open, merging A and B.
    // 100 − 40 + 100 − 100 = 60 still open at the end, so it is one open trade.
    await t.patch(`/api/executions/${aSell.body.execution.id}`, { quantity: sh(40) });
    const merged = (await t.get('/api/trades')).body.trades;
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: a.body.tradeId, status: 'OPEN' });

    const orphans = (await t.get('/api/trades?orphaned=only')).body.trades;
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ id: b.body.tradeId, orphaned: true, netPnl: null });
    const orphanDetail = (await t.get(`/api/trades/${b.body.tradeId}`)).body;
    expect(orphanDetail.journal.thesis).toBe('B notes');
    expect(orphanDetail.executions).toEqual([]);

    // Undo the edit: B's journal entry gets its executions back.
    await t.patch(`/api/executions/${aSell.body.execution.id}`, { quantity: sh(100) });
    const split = (await t.get('/api/trades')).body.trades;
    expect(split.map((x: { id: number }) => x.id).sort()).toEqual(
      [a.body.tradeId, b.body.tradeId].sort(),
    );
    expect((await t.get('/api/trades?orphaned=only')).body.trades).toEqual([]);
  });

  it('deletes trade rows that carry no journal data when they disappear', async () => {
    const t = createTestApp();
    const a = await t.post('/api/executions', fill('BUY', 100, '10', at(2)));
    expect((await t.del(`/api/executions/${a.body.execution.id}`)).status).toBe(204);
    expect((await t.get('/api/trades?orphaned=include')).body.trades).toEqual([]);
  });

  it('keeps journal data when the only execution is deleted, and lets the user dismiss it', async () => {
    const t = createTestApp();
    const a = await t.post('/api/executions', fill('BUY', 100, '10', at(2)));
    await t.patch(`/api/trades/${a.body.tradeId}`, { review: 'keep me' });
    await t.del(`/api/executions/${a.body.execution.id}`);
    const orphans = (await t.get('/api/trades?orphaned=only')).body.trades;
    expect(orphans.map((x: { id: number }) => x.id)).toEqual([a.body.tradeId]);
    expect((await t.get('/api/trades')).body.trades).toEqual([]); // hidden by default
    expect((await t.del(`/api/trades/${a.body.tradeId}`)).status).toBe(204);
    expect((await t.get('/api/trades?orphaned=only')).body.trades).toEqual([]);
  });
});

describe('regrouping when the stable-key execution disappears', () => {
  it('keeps the journal on the trade when its first fill is deleted', async () => {
    const t = createTestApp();
    const first = await t.post('/api/executions', fill('BUY', 50, '49', at(2)));
    await t.post('/api/executions', fill('BUY', 50, '50', at(3)));
    await t.post('/api/executions', fill('SELL', 50, '55', at(4)));
    const tradeId = first.body.tradeId as number;
    await t.patch(`/api/trades/${tradeId}`, { thesis: 'keep me attached' });

    // The first buy was a typo.
    expect((await t.del(`/api/executions/${first.body.execution.id}`)).status).toBe(204);

    const trades = (await t.get('/api/trades')).body.trades;
    expect(trades).toHaveLength(1);
    expect(trades[0].id).toBe(tradeId); // same row, re-keyed
    expect((await t.get(`/api/trades/${tradeId}`)).body.journal.thesis).toBe('keep me attached');
    expect((await t.get('/api/trades?orphaned=only')).body.trades).toEqual([]);
  });

  it('undoing an earlier-dated insert hands the journal back to the original trade', async () => {
    const t = createTestApp();
    const b = await t.post('/api/executions', fill('BUY', 100, '50', at(5)));
    await t.post('/api/executions', fill('SELL', 100, '55', at(9)));
    await t.patch(`/api/trades/${b.body.tradeId}`, { thesis: 'original' });
    const early = await t.post('/api/executions', fill('BUY', 10, '49', at(3)));
    await t.del(`/api/executions/${early.body.execution.id}`);
    // (the position is 10 sh larger in between; deleting the early buy restores the original)
    const detail = (await t.get(`/api/trades/${b.body.tradeId}`)).body;
    expect(detail.stableKey).toBe(b.body.execution.id);
    expect(detail.journal.thesis).toBe('original');
    expect(detail.orphaned).toBe(false);
  });
});
