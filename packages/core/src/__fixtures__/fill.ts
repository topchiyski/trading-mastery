// Test-only helpers for building executions with readable dollar amounts.
import { toMicros } from '../money';
import type { Execution, Side } from '../types';

let autoId = 1000;

export interface FillOptions {
  id?: number;
  symbol?: string;
  commission?: string;
  otherFees?: string;
  externalId?: string | null;
}

export function fill(
  side: Side,
  quantity: number,
  price: string,
  executedAt: string,
  opts: FillOptions = {},
): Execution {
  return {
    id: opts.id ?? autoId++,
    symbol: opts.symbol ?? 'AAPL',
    side,
    quantity,
    price: toMicros(price),
    commission: toMicros(opts.commission ?? '0'),
    otherFees: toMicros(opts.otherFees ?? '0'),
    executedAt,
    externalId: opts.externalId ?? null,
  };
}

/** Shorthand for a timestamp on a March 2026 trading day at 15:00 UTC (10:00 New York, EST). */
export const at = (day: number, minute = 0) =>
  `2026-03-${String(day).padStart(2, '0')}T15:${String(minute).padStart(2, '0')}:00.000Z`;
