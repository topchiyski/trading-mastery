/**
 * Share quantities are integer micro-shares (1 share = 1_000_000), mirroring money micros,
 * so fractional positions add up to exactly zero.
 */
import { formatMicros, mulDiv, toMicros, type Micros } from './money';

export type Quantity = number;

export const SHARE_UNITS = 1_000_000;

/** Parse a share amount (e.g. "0.5", 100) to micro-shares. */
export function toQuantity(value: number | string): Quantity {
  return toMicros(value);
}

export function fromQuantity(q: Quantity): number {
  return q / SHARE_UNITS;
}

/** "100", "0.5", "1,234.5" — no trailing zeros. */
export function formatQuantity(q: Quantity): string {
  const [int = '0', frac = ''] = formatMicros(q, 6).split('.');
  const trimmed = frac.replace(/0+$/, '');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** shares × price, in micros. */
export function notional(q: Quantity, price: Micros): Micros {
  return mulDiv(q, price, SHARE_UNITS);
}

/** Per-share price from a total and a quantity, in micros. */
export function perShare(total: Micros, q: Quantity): Micros {
  return mulDiv(total, SHARE_UNITS, q);
}
