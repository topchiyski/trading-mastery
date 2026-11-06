import { formatQuantity, formatUsd, toNyLocal, type HoldingPeriod } from '@tj/core';

const DASH = '—';

export function fmtMoney(micros: number | null | undefined): string {
  return micros == null ? DASH : formatUsd(micros);
}

/** Prices: 2 decimals, or 4 when the price has sub-cent precision. */
export function fmtPrice(micros: number | null | undefined): string {
  if (micros == null) return DASH;
  return formatUsd(micros, micros % 10_000 === 0 ? 2 : 4);
}

/** toFixed without a "-0.00" for values that round to zero. */
function fixed(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

export function fmtPct(ratio: number | null | undefined, decimals = 2): string {
  return ratio == null ? DASH : `${fixed(ratio * 100, decimals)}%`;
}

export function fmtR(r: number | null | undefined): string {
  return r == null ? DASH : `${fixed(r, 2)}R`;
}

export function fmtNyDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const { date, time } = toNyLocal(iso);
  return `${date} ${time}`;
}

export function fmtNyDate(iso: string | null | undefined): string {
  return iso ? toNyLocal(iso).date : DASH;
}

export function fmtDays(h: HoldingPeriod | null | undefined): string {
  if (!h) return DASH;
  return h.calendarDays === h.tradingDays
    ? `${h.tradingDays}d`
    : `${h.tradingDays}d (${h.calendarDays} cal)`;
}

/** Tone class for a P&L-like number. */
export function tone(n: number | null | undefined): 'pos' | 'neg' | '' {
  if (n == null || n === 0) return '';
  return n > 0 ? 'pos' : 'neg';
}

/** Micro-shares as readable shares ("100", "0.5"). */
export function fmtQty(q: number | null | undefined): string {
  return q == null ? DASH : formatQuantity(q);
}
