/**
 * Market-data calculations on daily bars: MAE/MFE, split detection, benchmark index.
 * Daily bars only approximate intraday extremes on the entry and exit days.
 */
import type { IsoDate } from './dates';
import type { Micros } from './money';
import { notional, type Quantity } from './quantity';

export interface DailyBar {
  date: IsoDate;
  open: Micros;
  high: Micros;
  low: Micros;
  close: Micros;
}

export interface Excursion {
  /** Move per share against the average entry (MAE ≤ 0, MFE ≥ 0). */
  perShare: Micros;
  dollars: Micros;
  /** perShare ÷ average entry. */
  pct: number;
  /** dollars ÷ initial risk; null without a stop. */
  r: number | null;
}

/**
 * MAE = largest adverse move below the average entry (lowest low), MFE = largest
 * favourable move above it (highest high), over the trade's bars from entry to exit.
 * Dollars use the total shares bought.
 */
export function excursions(input: {
  avgEntry: Micros;
  quantity: Quantity;
  initialRisk: Micros | null;
  bars: readonly DailyBar[];
}): {
  mae: Excursion;
  mfe: Excursion;
  lowestLow: Micros;
  highestHigh: Micros;
  bars: number;
} | null {
  if (input.bars.length === 0) return null;
  const lowestLow = Math.min(...input.bars.map((b) => b.low));
  const highestHigh = Math.max(...input.bars.map((b) => b.high));
  const make = (perShare: number): Excursion => {
    const dollars = notional(input.quantity, perShare);
    return {
      perShare,
      dollars,
      pct: perShare / input.avgEntry || 0,
      r: input.initialRisk ? dollars / input.initialRisk || 0 : null,
    };
  };
  return {
    mae: make(Math.min(0, lowestLow - input.avgEntry)),
    mfe: make(Math.max(0, highestHigh - input.avgEntry)),
    lowestLow,
    highestHigh,
    bars: input.bars.length,
  };
}

export interface SplitEvent {
  date: IsoDate;
  /** New shares per old share (2 = 2:1 split, 1/3 = 1:3 reverse split). */
  ratio: number;
  source: 'provider' | 'price-jump';
}

/** Whole and 3:2 split ratios, both directions. */
const SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((n) => [n, 1 / n]);
const TOLERANCE = 0.03;

/**
 * Splits from the provider's split factor where present, otherwise from close-to-close
 * price ratios within 3% of a split ratio. v1 only flags them; it does not adjust trades.
 */
export function detectSplits(
  bars: readonly { date: IsoDate; close: Micros; splitFactor?: number | null }[],
): SplitEvent[] {
  const out: SplitEvent[] = [];
  bars.forEach((b, i) => {
    if (b.splitFactor && b.splitFactor !== 1) {
      out.push({ date: b.date, ratio: b.splitFactor, source: 'provider' });
      return;
    }
    const prev = bars[i - 1];
    if (!prev || b.close <= 0) return;
    const jump = prev.close / b.close;
    const match = SPLIT_RATIOS.find((r) => Math.abs(jump / r - 1) <= TOLERANCE);
    if (match) out.push({ date: b.date, ratio: match, source: 'price-jump' });
  });
  return out;
}

/**
 * A price series indexed to 100 at its first available date, sampled on `dates`
 * (missing dates carry the last price forward; dates before the first price are null).
 */
export function benchmarkIndex(
  prices: ReadonlyMap<IsoDate, Micros>,
  dates: readonly IsoDate[],
): { date: IsoDate; value: number | null }[] {
  let base: number | null = null;
  let last: number | null = null;
  return dates.map((date) => {
    const p = prices.get(date);
    if (p !== undefined) last = p;
    if (base === null && last !== null) base = last;
    return { date, value: base !== null && last !== null ? (last / base) * 100 : null };
  });
}
