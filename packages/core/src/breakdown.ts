import { toNyDate, weekday } from './dates';
import type { Micros } from './money';
import { outcomeStats, type OutcomeInput, type OutcomeStats } from './outcome';

export interface BreakdownRow extends OutcomeStats {
  key: string;
}

export interface BreakdownOptions {
  breakEvenThreshold?: Micros;
  /** Row order; keys not listed come after, alphabetically. Default: alphabetical. */
  order?: readonly string[];
}

/**
 * Outcome stats per group. `keyOf` may return several keys (e.g. mistake tags), in which
 * case the trade counts in each group; null/undefined/empty skips the trade.
 * For mistake tags, `totalNetPnl` is the "cost of mistakes".
 */
export function breakdownBy<T extends OutcomeInput>(
  trades: readonly T[],
  keyOf: (trade: T) => string | readonly string[] | null | undefined,
  opts: BreakdownOptions = {},
): BreakdownRow[] {
  const groups = new Map<string, T[]>();
  for (const t of trades) {
    const raw = keyOf(t);
    const keys = raw == null ? [] : typeof raw === 'string' ? [raw] : raw;
    for (const key of new Set(keys)) {
      const list = groups.get(key);
      if (list) list.push(t);
      else groups.set(key, [t]);
    }
  }

  const rank = new Map((opts.order ?? []).map((k, i) => [k, i]));
  const keys = [...groups.keys()].sort((a, b) => {
    const ra = rank.get(a) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(b) ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return keys.map((key) => ({
    key,
    ...outcomeStats(groups.get(key) ?? [], opts.breakEvenThreshold),
  }));
}

export const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_BY_INDEX = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Weekday name of a timestamp's New York date. */
export function weekdayOfEntry(openedAt: string): string {
  return WEEKDAY_BY_INDEX[weekday(toNyDate(openedAt))] ?? 'Sun';
}

/** 'YYYY-MM' of a timestamp's New York date. */
export function monthOf(iso: string): string {
  return toNyDate(iso).slice(0, 7);
}
