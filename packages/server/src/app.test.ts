import { describe, expect, it } from 'vitest';
import { createTestApp } from './__fixtures__/test-app';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const t = createTestApp();
    const res = await t.get<{ status: string; time: string }>('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(res.body.time))).toBe(false);
  });
});

describe('error handling', () => {
  it('returns 404 JSON for unknown routes and 400 for malformed JSON', async () => {
    const t = createTestApp();
    expect((await t.get('/api/nope')).status).toBe(404);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: { 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
});
