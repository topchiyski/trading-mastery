/**
 * Candle cache in front of a MarketDataProvider.
 *
 * Every fetched date range is recorded in `candle_coverage`, so cached ranges (including
 * days with no bar) are never requested again; only missing trading-day ranges are fetched.
 * Today's bar is fetched only after 18:00 New York. Requests never wait for the rate
 * limiter: if it is exhausted the caller gets the cached data and a `rate-limited` note.
 */
import { addDays, isTradingDay, toNyLocal, tradingDaysInRange, type IsoDate } from '@tj/core';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { candleCoverage, candles, type CandleRow } from '../db/schema';
import { ProviderError, type MarketDataProvider, type ProviderErrorKind } from './provider';
import { RateLimiter } from './rate-limiter';

export interface EnsureResult {
  /** Provider requests made. */
  requests: number;
  /** True when the whole range (up to the last complete day) is cached. */
  complete: boolean;
  error?: { kind: ProviderErrorKind | 'not-configured'; message: string };
}

export class MarketData {
  readonly provider: MarketDataProvider | null;
  readonly limiter: RateLimiter;
  private readonly db: DbOrTx;
  private readonly now: () => Date;

  constructor(opts: {
    db: DbOrTx;
    provider: MarketDataProvider | null;
    limiter?: RateLimiter;
    now?: () => Date;
  }) {
    this.db = opts.db;
    this.provider = opts.provider;
    this.limiter =
      opts.limiter ?? new RateLimiter([{ max: 50, windowMs: 3_600_000, label: 'hour' }]);
    this.now = opts.now ?? (() => new Date());
  }

  get configured(): boolean {
    return this.provider !== null;
  }

  /** The latest trading day whose daily bar is final (after 18:00 New York). */
  lastCompleteDay(): IsoDate {
    const { date, time } = toNyLocal(this.now().toISOString());
    if (isTradingDay(date) && time >= '18:00') return date;
    let d = addDays(date, -1);
    while (!isTradingDay(d)) d = addDays(d, -1);
    return d;
  }

  candles(symbol: string, from: IsoDate, to: IsoDate): CandleRow[] {
    return this.db
      .select()
      .from(candles)
      .where(and(eq(candles.symbol, symbol), gte(candles.date, from), lte(candles.date, to)))
      .orderBy(asc(candles.date))
      .all();
  }

  /** Latest cached bar on or before `on`. */
  lastBar(symbol: string, on: IsoDate): CandleRow | undefined {
    return this.db
      .select()
      .from(candles)
      .where(and(eq(candles.symbol, symbol), lte(candles.date, on)))
      .orderBy(asc(candles.date))
      .all()
      .at(-1);
  }

  /** Trading-day ranges in [from, to] (capped at the last complete day) not yet fetched. */
  missingRanges(symbol: string, from: IsoDate, to: IsoDate): [IsoDate, IsoDate][] {
    const last = this.lastCompleteDay();
    const end = to < last ? to : last;
    if (end < from) return [];
    const covered = this.db
      .select()
      .from(candleCoverage)
      .where(eq(candleCoverage.symbol, symbol))
      .all();
    const days = tradingDaysInRange(from, end);
    const isCovered = (d: IsoDate) => covered.some((c) => c.fromDate <= d && d <= c.toDate);
    const ranges: [IsoDate, IsoDate][] = [];
    let runStart: number | null = null;
    days.forEach((d, i) => {
      const missing = !isCovered(d);
      if (missing && runStart === null) runStart = i;
      if ((!missing || i === days.length - 1) && runStart !== null) {
        const endIdx = missing ? i : i - 1;
        ranges.push([days[runStart] as IsoDate, days[endIdx] as IsoDate]);
        runStart = null;
      }
    });
    return ranges;
  }

  /** Make sure [from, to] is cached, fetching missing ranges if the rate limit allows. */
  async ensure(symbol: string, from: IsoDate, to: IsoDate): Promise<EnsureResult> {
    const missing = this.missingRanges(symbol, from, to);
    if (missing.length === 0) return { requests: 0, complete: true };
    if (!this.provider) {
      return {
        requests: 0,
        complete: false,
        error: { kind: 'not-configured', message: 'No market-data provider configured' },
      };
    }
    let requests = 0;
    let error: EnsureResult['error'];
    for (const [a, b] of missing) {
      if (!this.limiter.tryAcquire()) {
        return {
          requests,
          complete: false,
          error: {
            kind: 'rate-limited',
            message: `Rate limit reached; retry in ${Math.ceil(this.limiter.waitMs() / 60_000)} min`,
          },
        };
      }
      requests++;
      try {
        const bars = await this.provider.getDailyCandles(symbol, a, b);
        this.store(symbol, bars, a, b);
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        if (err.kind === 'not-found') {
          // Remember that there is nothing to fetch, so we don't ask again.
          this.store(symbol, [], a, b);
          error = { kind: err.kind, message: err.message };
          continue;
        }
        return { requests, complete: false, error: { kind: err.kind, message: err.message } };
      }
    }
    return { requests, complete: true, ...(error ? { error } : {}) };
  }

  private store(
    symbol: string,
    bars: Awaited<ReturnType<MarketDataProvider['getDailyCandles']>>,
    from: IsoDate,
    to: IsoDate,
  ) {
    const provider = this.provider?.name ?? 'unknown';
    const db = this.db;
    for (const b of bars) {
      const row = {
        symbol,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        adjClose: b.adjClose,
        volume: b.volume,
        splitFactor: b.splitFactor,
        provider,
      };
      db.insert(candles)
        .values(row)
        .onConflictDoUpdate({ target: [candles.symbol, candles.date], set: row })
        .run();
    }
    db.insert(candleCoverage)
      .values({ symbol, fromDate: from, toDate: to, provider })
      .onConflictDoNothing()
      .run();
  }
}
