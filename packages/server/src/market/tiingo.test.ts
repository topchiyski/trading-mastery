import { toMicros as $ } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { ProviderError } from './provider';
import { TiingoProvider } from './tiingo';

/** A fake fetch that records requests and replies with a canned response. No network. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const tiingoRow = {
  date: '2026-06-10T00:00:00.000Z',
  open: 100.5,
  high: 102.25,
  low: 99.75,
  close: 101.1,
  volume: 123456,
  adjClose: 100.9,
  adjHigh: 102,
  adjLow: 99.5,
  adjOpen: 100.3,
  adjVolume: 123456,
  divCash: 0,
  splitFactor: 1,
};

describe('TiingoProvider', () => {
  it('requests the daily prices endpoint with the token header and maps rows to micros', async () => {
    const f = fakeFetch(200, [
      tiingoRow,
      { ...tiingoRow, date: '2026-06-11T00:00:00.000Z', splitFactor: 4 },
    ]);
    const p = new TiingoProvider('secret-token', f.fn);
    const bars = await p.getDailyCandles('BRK.B', '2026-06-10', '2026-06-11');
    expect(f.calls).toEqual([
      {
        url: 'https://api.tiingo.com/tiingo/daily/BRK-B/prices?startDate=2026-06-10&endDate=2026-06-11&format=json',
        headers: { Authorization: 'Token secret-token', 'Content-Type': 'application/json' },
      },
    ]);
    expect(bars).toEqual([
      {
        date: '2026-06-10',
        open: $('100.5'),
        high: $('102.25'),
        low: $('99.75'),
        close: $('101.1'),
        adjClose: $('100.9'),
        volume: 123456,
        splitFactor: 1,
      },
      {
        date: '2026-06-11',
        open: $('100.5'),
        high: $('102.25'),
        low: $('99.75'),
        close: $('101.1'),
        adjClose: $('100.9'),
        volume: 123456,
        splitFactor: 4,
      },
    ]);
  });

  it.each([
    [404, 'not-found'],
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limited'],
    [500, 'bad-response'],
  ] as const)('maps HTTP %i to a %s error', async (status, kind) => {
    const p = new TiingoProvider('k', fakeFetch(status, { detail: 'nope' }).fn);
    await expect(p.getDailyCandles('AAPL', '2026-06-10', '2026-06-11')).rejects.toMatchObject({
      kind,
    });
  });

  it('rejects malformed bodies and network failures', async () => {
    await expect(
      new TiingoProvider('k', fakeFetch(200, { detail: 'x' }).fn).getDailyCandles(
        'A',
        '2026-01-01',
        '2026-01-02',
      ),
    ).rejects.toMatchObject({ kind: 'bad-response' });
    const broken = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const err = await new TiingoProvider('k', broken)
      .getDailyCandles('A', '2026-01-01', '2026-01-02')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'network' });
  });

  it('never puts the token in the URL or error messages', async () => {
    const f = fakeFetch(401, { detail: 'Invalid token' });
    const err = (await new TiingoProvider('secret-token', f.fn)
      .getDailyCandles('A', '2026-01-01', '2026-01-02')
      .catch((e: unknown) => e)) as Error;
    expect(f.calls[0]!.url).not.toContain('secret');
    expect(err.message).not.toContain('secret');
  });
});
