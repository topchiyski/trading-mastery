import { toMicros as $ } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../__fixtures__/test-app';

describe('cash flows API', () => {
  it('creates, lists by date range, updates and deletes cash flows', async () => {
    const t = createTestApp();
    const dep = await t.post('/api/cash-flows', {
      type: 'DEPOSIT',
      amount: $('10000'),
      occurredAt: '2026-03-02',
      note: 'Initial funding',
    });
    expect(dep.status).toBe(201);
    expect(dep.body).toMatchObject({
      type: 'DEPOSIT',
      amount: $('10000'),
      occurredAt: '2026-03-02',
    });
    await t.post('/api/cash-flows', {
      type: 'DIVIDEND',
      amount: $('12.5'),
      occurredAt: '2026-04-15T12:00:00-04:00',
    });
    await t.post('/api/cash-flows', {
      type: 'WITHDRAWAL',
      amount: $('-500'),
      occurredAt: '2026-05-01',
    });

    const all = (await t.get('/api/cash-flows')).body.cashFlows;
    expect(all.map((c: { type: string }) => c.type)).toEqual(['DEPOSIT', 'DIVIDEND', 'WITHDRAWAL']);
    expect(all[1].occurredAt).toBe('2026-04-15T16:00:00.000Z');
    const april = (await t.get('/api/cash-flows?from=2026-04-01&to=2026-04-30')).body.cashFlows;
    expect(april.map((c: { type: string }) => c.type)).toEqual(['DIVIDEND']);

    const upd = await t.patch(`/api/cash-flows/${dep.body.id}`, { amount: $('12000') });
    expect(upd.body.amount).toBe($('12000'));
    expect((await t.del(`/api/cash-flows/${dep.body.id}`)).status).toBe(204);
    expect((await t.get('/api/cash-flows')).body.cashFlows).toHaveLength(2);
  });

  it('enforces the sign of deposits and withdrawals', async () => {
    const t = createTestApp();
    const bad = [
      { type: 'DEPOSIT', amount: $('-1'), occurredAt: '2026-03-02' },
      { type: 'WITHDRAWAL', amount: $('1'), occurredAt: '2026-03-02' },
      { type: 'FEE', amount: 0, occurredAt: '2026-03-02' },
      { type: 'BONUS', amount: 1, occurredAt: '2026-03-02' },
      { type: 'DEPOSIT', amount: 1, occurredAt: 'soon' },
    ];
    for (const b of bad) expect((await t.post('/api/cash-flows', b)).status, b.type).toBe(400);
    const dep = await t.post('/api/cash-flows', {
      type: 'DEPOSIT',
      amount: 1,
      occurredAt: '2026-03-02',
    });
    expect((await t.patch(`/api/cash-flows/${dep.body.id}`, { type: 'WITHDRAWAL' })).status).toBe(
      400,
    );
    expect((await t.patch('/api/cash-flows/999', { note: 'x' })).status).toBe(404);
    expect((await t.del('/api/cash-flows/999')).status).toBe(404);
  });
});
