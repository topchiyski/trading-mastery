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

describe('RateLimiter boundaries', () => {
  it.each([
    [999, false], // 1 ms before the window ends: still blocked
    [1000, true], // exactly when the oldest request leaves the window
  ])('after %i ms a full window allows a request: %s', (ms, allowed) => {
    const c = clock();
    const rl = new RateLimiter([{ max: 1, windowMs: 1000 }], c.now);
    rl.tryAcquire();
    c.advance(ms);
    expect(rl.tryAcquire()).toBe(allowed);
  });

  it.each([
    [2, true],
    [3, false],
  ])('with max 3, request number %i+1 in one window is allowed: %s', (used, allowed) => {
    const rl = new RateLimiter([{ max: 3, windowMs: 1000 }], () => 0);
    for (let i = 0; i < used; i++) rl.tryAcquire();
    expect(rl.tryAcquire()).toBe(allowed);
  });

  it('labels a window without a label by its length, and uses the real clock by default', () => {
    expect(new RateLimiter([{ max: 1, windowMs: 500 }]).usage()).toEqual([
      { label: '500ms', used: 0, max: 1 },
    ]);
  });
});
