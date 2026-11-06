import type { Db } from '../db/client';
import { MarketData } from './market-data';
import type { MarketDataProvider } from './provider';
import { RateLimiter, tiingoFreeLimits } from './rate-limiter';
import { SyntheticProvider } from './synthetic';
import { TiingoProvider } from './tiingo';

/**
 * MARKET_DATA_PROVIDER = tiingo | synthetic | none.
 * Default: tiingo when MARKET_DATA_API_KEY is set, otherwise none.
 */
export function marketDataFromEnv(db: Db, env: NodeJS.ProcessEnv = process.env): MarketData {
  const key = env['MARKET_DATA_API_KEY']?.trim() ?? '';
  const choice = (env['MARKET_DATA_PROVIDER']?.trim().toLowerCase() ||
    (key ? 'tiingo' : 'none')) as string;
  let provider: MarketDataProvider | null = null;
  let limiter = new RateLimiter(tiingoFreeLimits());
  if (choice === 'tiingo') {
    provider = key ? new TiingoProvider(key) : null;
  } else if (choice === 'synthetic') {
    provider = new SyntheticProvider();
    limiter = new RateLimiter([{ max: 10_000, windowMs: 60_000, label: 'minute' }]);
  } else if (choice !== 'none') {
    throw new Error(`Unknown MARKET_DATA_PROVIDER "${choice}" (use tiingo, synthetic or none)`);
  }
  return new MarketData({ db, provider, limiter });
}
