import { tradingDaysInRange, type IsoDate } from '@tj/core';
import type { MarketDataProvider, ProviderBar } from './provider';

/** Small deterministic hash -> [0, 1). */
function unit(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * Offline provider with deterministic made-up bars (no network): used by E2E runs and
 * demo/dev mode (MARKET_DATA_PROVIDER=synthetic). Each symbol drifts around its own base
 * price; the same symbol and date always give the same bar.
 */
export class SyntheticProvider implements MarketDataProvider {
  readonly name: string = 'synthetic';

  async getDailyCandles(symbol: string, from: IsoDate, to: IsoDate): Promise<ProviderBar[]> {
    const base = 20 + unit(symbol) * 480;
    return tradingDaysInRange(from, to).map((date) => {
      const t = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
      const mid = base * (1 + 0.15 * Math.sin(t / 23 + unit(symbol) * 6) + 0.04 * Math.sin(t / 3));
      const spread = mid * (0.01 + unit(symbol + date) * 0.02);
      const open = mid - spread * (unit(date + symbol) - 0.5);
      const close = mid + spread * (unit(symbol + date + 'c') - 0.5);
      const cents = (v: number) => Math.round(v * 100) * 10_000;
      return {
        date,
        open: cents(open),
        high: cents(Math.max(open, close) + spread / 2),
        low: cents(Math.min(open, close) - spread / 2),
        close: cents(close),
        adjClose: cents(close),
        volume: Math.round(1e6 * (0.5 + unit(date + symbol + 'v'))),
        splitFactor: 1,
      };
    });
  }
}
