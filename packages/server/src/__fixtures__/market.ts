// Test-only market-data helpers: a mocked provider (synthetic bars, call log) and a fixed clock.
import type { OpenDatabase } from '../db/client';
import { MarketData } from '../market/market-data';
import type { MarketDataProvider, ProviderBar } from '../market/provider';
import { RateLimiter } from '../market/rate-limiter';
import { SyntheticProvider } from '../market/synthetic';

export class MockProvider implements MarketDataProvider {
  readonly name = 'mock';
  calls: [string, string, string][] = [];
  /** Per-symbol tweaks applied to the synthetic bars (e.g. a split factor on a date). */
  patch: (symbol: string, bars: ProviderBar[]) => ProviderBar[] = (_s, b) => b;
  private readonly inner = new SyntheticProvider();

  async getDailyCandles(symbol: string, from: string, to: string): Promise<ProviderBar[]> {
    this.calls.push([symbol, from, to]);
    return this.patch(symbol, await this.inner.getDailyCandles(symbol, from, to));
  }
}

/** Fri 2026-03-13 20:00 New York: the Mar 13 bar is final. */
export const NOW = new Date('2026-03-14T00:00:00Z');

export function mockMarket(provider: MockProvider, maxRequests = 100) {
  return (db: OpenDatabase['db']) =>
    new MarketData({
      db,
      provider,
      limiter: new RateLimiter([{ max: maxRequests, windowMs: 3_600_000, label: 'hour' }]),
      now: () => NOW,
    });
}
