import { describe, expect, it } from 'vitest';
import { APP_NAME, healthStatus } from './index';

describe('healthStatus', () => {
  it('reports ok with an ISO timestamp', () => {
    const now = new Date('2026-01-02T15:30:00.000Z');
    expect(healthStatus(now)).toEqual({
      status: 'ok',
      app: APP_NAME,
      time: '2026-01-02T15:30:00.000Z',
    });
  });
});
