import { toMicros, type IsoDate } from '@tj/core';
import { ProviderError, type MarketDataProvider, type ProviderBar } from './provider';

interface TiingoRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number | null;
  splitFactor?: number | null;
}

const isRow = (r: unknown): r is TiingoRow =>
  !!r &&
  typeof r === 'object' &&
  ['date', 'open', 'high', 'low', 'close'].every((k) => k in (r as object));

/**
 * Tiingo end-of-day prices (https://www.tiingo.com/documentation/end-of-day).
 * Raw OHLC plus adjusted close and split factor. The token goes in a header, never the URL.
 */
export class TiingoProvider implements MarketDataProvider {
  readonly name = 'tiingo';

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getDailyCandles(symbol: string, from: IsoDate, to: IsoDate): Promise<ProviderBar[]> {
    // Tiingo writes share classes with a dash: BRK.B -> BRK-B.
    const ticker = encodeURIComponent(symbol.replace(/\./g, '-'));
    const url = `https://api.tiingo.com/tiingo/daily/${ticker}/prices?startDate=${from}&endDate=${to}&format=json`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Token ${this.token}`, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      throw new ProviderError(
        'network',
        `Tiingo unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status === 404)
      throw new ProviderError('not-found', `Tiingo has no data for ${symbol}`);
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('auth', 'Tiingo rejected the API token (check MARKET_DATA_API_KEY)');
    }
    if (res.status === 429) throw new ProviderError('rate-limited', 'Tiingo rate limit reached');
    if (!res.ok) throw new ProviderError('bad-response', `Tiingo answered HTTP ${res.status}`);

    const body: unknown = await res.json().catch(() => null);
    if (!Array.isArray(body) || !body.every(isRow)) {
      throw new ProviderError('bad-response', `Unexpected Tiingo response for ${symbol}`);
    }
    return body.map((r) => ({
      date: r.date.slice(0, 10),
      open: toMicros(r.open),
      high: toMicros(r.high),
      low: toMicros(r.low),
      close: toMicros(r.close),
      adjClose: typeof r.adjClose === 'number' ? toMicros(r.adjClose) : null,
      volume: Math.round(r.volume ?? 0),
      splitFactor: typeof r.splitFactor === 'number' ? r.splitFactor : null,
    }));
  }
}
