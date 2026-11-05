import { toMicros as $ } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../__fixtures__/test-app';

describe('settings API', () => {
  it('returns defaults', async () => {
    const t = createTestApp();
    const res = await t.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      startingBalance: 0,
      startDate: null,
      breakEvenThreshold: $('1'),
      defaultCommission: 0,
    });
  });

  it('updates settings partially and persists them', async () => {
    const t = createTestApp();
    const res = await t.put('/api/settings', {
      startingBalance: $('25000'),
      startDate: '2026-01-02',
    });
    expect(res.body).toMatchObject({
      startingBalance: $('25000'),
      startDate: '2026-01-02',
      breakEvenThreshold: $('1'),
    });
    await t.put('/api/settings', { breakEvenThreshold: $('5') });
    expect((await t.get('/api/settings')).body).toMatchObject({
      startingBalance: $('25000'),
      breakEvenThreshold: $('5'),
    });
  });

  it('validates values', async () => {
    const t = createTestApp();
    expect((await t.put('/api/settings', { breakEvenThreshold: -1 })).status).toBe(400);
    expect((await t.put('/api/settings', { startDate: '2026-02-30' })).status).toBe(400);
    expect((await t.put('/api/settings', { theme: 'dark' })).status).toBe(400);
  });
});
