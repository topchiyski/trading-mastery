/**
 * Background backfill: works out which daily candles the journal needs (every traded
 * symbol around its trades, plus SPY for the benchmark) and fetches what is missing,
 * one symbol per request, until done or the rate limit is reached. Safe to run often:
 * cached ranges are never re-requested.
 */
import { addDays, nyDateOf, type IsoDate } from '@tj/core';
import type { DbOrTx } from '../db/client';
import { getSettings } from '../repo/settings';
import { listTrades } from '../repo/trades';
import type { EnsureResult, MarketData } from './market-data';

/** Calendar days of chart context around each trade. */
export const DAYS_BEFORE = 30;
export const DAYS_AFTER = 10;
export const BENCHMARK = 'SPY';

const min = (a: IsoDate, b: IsoDate) => (a < b ? a : b);
const max = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

/** The date range of candles wanted for each symbol (trade symbols, then SPY). */
export function neededRanges(db: DbOrTx, md: MarketData): [string, [IsoDate, IsoDate]][] {
  const last = md.lastCompleteDay();
  const ranges = new Map<string, [IsoDate, IsoDate]>();
  const trades = listTrades(db, { orphaned: 'exclude' }).trades;
  for (const t of trades) {
    const from = addDays(nyDateOf(t.openedAt), -DAYS_BEFORE);
    const to = t.closedAt ? min(addDays(nyDateOf(t.closedAt), DAYS_AFTER), last) : last;
    const cur = ranges.get(t.symbol);
    ranges.set(t.symbol, cur ? [min(cur[0], from), max(cur[1], to)] : [from, to]);
  }
  // The benchmark needs the whole equity period, merged with any SPY trades of its own.
  const firstOpen = trades.map((t) => nyDateOf(t.openedAt)).sort()[0];
  const start = getSettings(db).startDate ?? firstOpen;
  const spyTrades = ranges.get(BENCHMARK);
  ranges.delete(BENCHMARK);
  const out = [...ranges].sort(([a], [b]) => a.localeCompare(b));
  if (start) {
    out.push([
      BENCHMARK,
      spyTrades ? [min(start, spyTrades[0]), max(last, spyTrades[1])] : [start, last],
    ]);
  } else if (spyTrades) {
    out.push([BENCHMARK, spyTrades]);
  }
  return out;
}

export class MarketSync {
  private running = false;
  private lastRunAt: string | null = null;
  private lastError: EnsureResult['error'] | null = null;
  private readonly failed = new Map<string, string>();

  constructor(
    private readonly db: DbOrTx,
    private readonly md: MarketData,
  ) {}

  pendingSymbols(): string[] {
    return neededRanges(this.db, this.md)
      .filter(
        ([s, [from, to]]) => !this.failed.has(s) && this.md.missingRanges(s, from, to).length > 0,
      )
      .map(([s]) => s);
  }

  /** Fetch missing candles until done or a provider/rate-limit problem stops the run. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastError = null;
    try {
      if (!this.md.configured) {
        this.lastError = { kind: 'not-configured', message: 'No market-data provider configured' };
        return;
      }
      for (const [symbol, [from, to]] of neededRanges(this.db, this.md)) {
        if (this.failed.has(symbol) || this.md.missingRanges(symbol, from, to).length === 0)
          continue;
        const r = await this.md.ensure(symbol, from, to);
        if (r.error?.kind === 'not-found') {
          this.failed.set(symbol, r.error.message);
          continue;
        }
        if (r.error) {
          this.lastError = r.error; // rate limit, auth or network: try again on a later run
          break;
        }
      }
    } finally {
      this.running = false;
      this.lastRunAt = new Date().toISOString();
    }
  }

  status() {
    return {
      configured: this.md.configured,
      provider: this.md.provider?.name ?? null,
      running: this.running,
      pendingSymbols: this.md.configured
        ? this.pendingSymbols().length
        : neededRanges(this.db, this.md).length,
      unknownSymbols: [...this.failed.keys()],
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      usage: this.md.limiter.usage(),
      nextSlotInMs: this.md.limiter.waitMs(),
      lastCompleteDay: this.md.lastCompleteDay(),
    };
  }
}
