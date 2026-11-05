import { isValidTicker, nyDateOf } from '@tj/core';
import { z } from 'zod';

export const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Integer micros within the safe integer range. */
export const micros = z.number().int().refine(Number.isSafeInteger, 'out of range');
export const positiveMicros = micros.refine((n) => n > 0, 'must be positive');
export const nonNegativeMicros = micros.refine((n) => n >= 0, 'must not be negative');

/** Strict: tickers must already be uppercase (the UI uppercases as you type). */
export const ticker = z
  .string()
  .refine(isValidTicker, 'invalid ticker (uppercase, e.g. AAPL, BRK.B)');

const isPlainDate = (s: string) => {
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && nyDateOf(s) === s;
  } catch {
    return false;
  }
};

/** YYYY-MM-DD, a real calendar date. */
export const plainDate = z.string().refine(isPlainDate, 'expected a date YYYY-MM-DD');

/** ISO-8601 timestamp with Z or an explicit offset; normalised to UTC. */
export const timestamp = z
  .string()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
    'expected an ISO timestamp with timezone, e.g. 2026-03-02T15:00:00Z',
  )
  .transform((s) => new Date(s).toISOString());

/** A plain date (kept as-is) or a timestamp (normalised to UTC). */
export const dateOrTimestamp = z.union([plainDate, timestamp]);

export const optionalText = z.string().max(20_000).nullable();
