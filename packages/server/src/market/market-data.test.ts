import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client';
import { MarketData } from './market-data';
import { ProviderError, type MarketDataProvider, type ProviderBar } from './provider';
import { RateLimiter } from './rate-limiter';
import { SyntheticProvider } from './synthetic';

/** Mocked provider: synthetic bars, records every call, can be told to fail. No network. */
class MockProvider implements MarketDataProvider {
  readonly name = 'mock';
  calls: [string, string, string][] = [];
  failWith: ProviderError | null = null;
  private readonly inner = new SyntheticProvider();
  async getDailyCandles(symbol: string, from: string, to: string): Promise<ProviderBar[]> {
    this.calls.push([symbol, from, to]);
    if (this.failWith) throw this.failWith;
    return this.inner.getDailyCandles(symbol, from, to);
  }
}

/** 2026-03-13 20:00 New York (after the close): Mar 13 is complete. */
const AFTER_CLOSE = new Date('2026-03-14T00:00:00Z');

function setup(
  opts: { now?: Date; limiter?: RateLimiter; provider?: MarketDataProvider | null } = {},
) {
  const { db } = openDatabase(':memory:');
  const provider = opts.provider === undefined ? new MockProvider() : opts.provider;
  const md = new MarketData({
    db,
    provider,
    limiter: opts.limiter ?? new RateLimiter([{ max: 100, windowMs: 60_000 }]),
    now: () => opts.now ?? AFTER_CLOSE,
  });
  return { md, provider: provider as MockProvider };
}

describe('MarketData candle cache', () => {
  it('serves a range from cache on the second request: 0 HTTP calls', async () => {
    const { md, provider } = setup();
    const first = await md.ensure('AAPL', '2026-03-02', '2026-03-06');
    expect(first).toEqual({ requests: 1, complete: true });
    expect(provider.calls).toEqual([['AAPL', '2026-03-02', '2026-03-06']]);
    expect(md.candles('AAPL', '2026-03-02', '2026-03-06')).toHaveLength(5);

    provider.calls = [];
    const second = await md.ensure('AAPL', '2026-03-02', '2026-03-06');
    expect(second).toEqual({ requests: 0, complete: true });
    expect(provider.calls).toEqual([]);
  });

  it('fetches only the missing trading-day ranges', async () => {
    const { md, provider } = setup();
    await md.ensure('AAPL', '2026-03-02', '2026-03-06');
    provider.calls = [];
    await md.ensure('AAPL', '2026-02-23', '2026-03-13');
    expect(provider.calls).toEqual([
      ['AAPL', '2026-02-23', '2026-02-27'],
      ['AAPL', '2026-03-09', '2026-03-13'],
    ]);
    expect(md.candles('AAPL', '2026-02-23', '2026-03-13')).toHaveLength(15);
  });

  it('needs no request for a range without trading days', async () => {
    const { md, provider } = setup();
    expect(await md.ensure('AAPL', '2026-03-07', '2026-03-08')).toEqual({
      requests: 0,
      complete: true,
    });
    expect(provider.calls).toEqual([]);
  });

  it("doesn't cache today before its bar is final, and fills it in after the close", async () => {
    let now = new Date('2026-03-10T15:00:00Z'); // 11:00 New York
    const provider = new MockProvider();
    const { db } = openDatabase(':memory:');
    const md = new MarketData({
      db,
      provider,
      limiter: new RateLimiter([{ max: 100, windowMs: 1 }]),
      now: () => now,
    });
    expect(md.lastCompleteDay()).toBe('2026-03-09');
    await md.ensure('AAPL', '2026-03-09', '2026-03-10');
    expect(provider.calls).toEqual([['AAPL', '2026-03-09', '2026-03-09']]);
    now = new Date('2026-03-10T23:30:00Z'); // 19:30 New York
    await md.ensure('AAPL', '2026-03-09', '2026-03-10');
    expect(provider.calls.at(-1)).toEqual(['AAPL', '2026-03-10', '2026-03-10']);
  });

  it('stops at the rate limit instead of waiting, and reports it', async () => {
    const { md, provider } = setup({ limiter: new RateLimiter([{ max: 1, windowMs: 60_000 }]) });
    await md.ensure('AAPL', '2026-03-02', '2026-03-06');
    const r = await md.ensure('MSFT', '2026-03-02', '2026-03-06');
    expect(r).toEqual({
      requests: 0,
      complete: false,
      error: { kind: 'rate-limited', message: expect.any(String) },
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('retries after a network error but not after "unknown symbol"', async () => {
    const { md, provider } = setup();
    provider.failWith = new ProviderError('network', 'down');
    expect((await md.ensure('AAPL', '2026-03-02', '2026-03-06')).error?.kind).toBe('network');
    provider.failWith = null;
    expect((await md.ensure('AAPL', '2026-03-02', '2026-03-06')).requests).toBe(1);

    provider.failWith = new ProviderError('not-found', 'no such ticker');
    expect((await md.ensure('ZZZZ', '2026-03-02', '2026-03-06')).error?.kind).toBe('not-found');
    provider.calls = [];
    expect(await md.ensure('ZZZZ', '2026-03-02', '2026-03-06')).toEqual({
      requests: 0,
      complete: true,
    });
    expect(provider.calls).toEqual([]);
  });

  it('works without a provider: cached data only, flagged as not configured', async () => {
    const { md } = setup({ provider: null });
    expect(md.configured).toBe(false);
    expect(await md.ensure('AAPL', '2026-03-02', '2026-03-06')).toEqual({
      requests: 0,
      complete: false,
      error: { kind: 'not-configured', message: expect.any(String) },
    });
    expect(md.candles('AAPL', '2026-03-02', '2026-03-06')).toEqual([]);
  });

  it('stores raw OHLC, adjusted close and split factor', async () => {
    const { md } = setup();
    await md.ensure('AAPL', '2026-03-02', '2026-03-02');
    const [bar] = md.candles('AAPL', '2026-03-02', '2026-03-02');
    expect(bar).toMatchObject({ date: '2026-03-02', provider: 'mock', splitFactor: 1 });
    expect(bar!.high).toBeGreaterThanOrEqual(bar!.low);
    expect(bar!.adjClose).toBe(bar!.close);
  });
});
