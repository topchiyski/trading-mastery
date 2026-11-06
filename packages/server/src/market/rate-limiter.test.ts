import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RateLimiter', () => {
  it('allows up to the limit within the window, then reports how long to wait', () => {
    const c = clock();
    const rl = new RateLimiter([{ max: 3, windowMs: 1000 }], c.now);
    expect([rl.tryAcquire(), rl.tryAcquire(), rl.tryAcquire()]).toEqual([true, true, true]);
    expect(rl.tryAcquire()).toBe(false);
    expect(rl.waitMs()).toBe(1000);
    c.advance(400);
    expect(rl.waitMs()).toBe(600);
    c.advance(600);
    expect(rl.tryAcquire()).toBe(true);
  });

  it('enforces every window (hourly and daily)', () => {
    const c = clock();
    const rl = new RateLimiter(
      [
        { max: 2, windowMs: 100 },
        { max: 3, windowMs: 10_000 },
      ],
      c.now,
    );
    rl.tryAcquire();
    rl.tryAcquire();
    c.advance(100);
    expect(rl.tryAcquire()).toBe(true); // short window freed
    c.advance(100);
    expect(rl.tryAcquire()).toBe(false); // daily window full
    expect(rl.waitMs()).toBe(10_000 - 200);
  });

  it('reports usage per window', () => {
    const c = clock();
    const rl = new RateLimiter([{ max: 50, windowMs: 3_600_000, label: 'hour' }], c.now);
    rl.tryAcquire();
    expect(rl.usage()).toEqual([{ label: 'hour', used: 1, max: 50 }]);
  });
});
