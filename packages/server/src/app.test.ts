import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('GET /api/health', () => {
  const app = buildApp();
  afterEach(async () => {
    await app.close();
  });

  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; time: string }>();
    expect(body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});
