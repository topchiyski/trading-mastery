import { excursions, nyDateOf } from '@tj/core';
import type { CandleRow } from '../db/schema';

/** MAE/MFE of a trade from cached bars between its entry and exit (or the last bar). */
export function tradeExcursions(
  bars: readonly CandleRow[],
  t: {
    openedAt: string;
    closedAt: string | null;
    avgEntry: number | null;
    quantity: number | null;
    initialRisk: number | null;
  },
) {
  if (t.avgEntry === null || t.quantity === null) return null;
  const from = nyDateOf(t.openedAt);
  const to = t.closedAt ? nyDateOf(t.closedAt) : '9999-12-31';
  return excursions({
    avgEntry: t.avgEntry,
    quantity: t.quantity,
    initialRisk: t.initialRisk,
    bars: bars.filter((b) => b.date >= from && b.date <= to),
  });
}
