/**
 * Money and prices are stored as integer micros: 1 USD = 1_000_000 micros.
 * All arithmetic that divides goes through `mulDiv` (BigInt, half-away-from-zero rounding).
 */
export type Micros = number;

export const MICROS_PER_UNIT = 1_000_000;

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?$/;

function assertSafe(n: number, what: string): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} is outside the safe integer range`);
  return n;
}

function parseDecimal(s: string): Micros {
  const m = DECIMAL_RE.exec(s);
  const intPart = m?.[2] ?? '';
  const frac = m?.[3] ?? '';
  if (!m || (intPart === '' && frac === '')) throw new RangeError(`Not a decimal number: "${s}"`);
  const padded = (frac + '0000000').slice(0, 7);
  let micros = BigInt(intPart || '0') * 1_000_000n + BigInt(padded.slice(0, 6));
  if (Number(padded[6]) >= 5) micros += 1n;
  return assertSafe(Number(m[1] === '-' ? -micros : micros), `"${s}"`) || 0;
}

/** Convert a decimal amount (string preferred, number accepted) to integer micros. */
export function toMicros(value: number | string): Micros {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
    const s = String(value);
    if (/e/i.test(s)) return assertSafe(Math.round(value * MICROS_PER_UNIT), s) || 0;
    return parseDecimal(s);
  }
  return parseDecimal(value.trim());
}

export function fromMicros(micros: Micros): number {
  return micros / MICROS_PER_UNIT;
}

/** round(a * b / c), half away from zero, without intermediate overflow. */
export function mulDiv(a: number, b: number, c: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
    throw new RangeError(`mulDiv expects integers, got ${a}, ${b}, ${c}`);
  }
  if (c === 0) throw new RangeError('Division by zero');
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  let q = n / d;
  const r = n % d;
  if (r !== 0n) {
    const absR2 = (r < 0n ? -r : r) * 2n;
    const absD = d < 0n ? -d : d;
    if (absR2 >= absD) q += n < 0n !== d < 0n ? -1n : 1n;
  }
  return assertSafe(Number(q), 'mulDiv result') || 0;
}

/** Format micros as a fixed-decimal string (no thousands separators). */
export function formatMicros(micros: Micros, decimals = 2): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new RangeError(`decimals must be 0..6, got ${decimals}`);
  }
  const rounded = mulDiv(Math.abs(micros), 1, 10 ** (6 - decimals));
  const digits = String(rounded).padStart(decimals + 1, '0');
  const int = digits.slice(0, digits.length - decimals);
  const frac = decimals > 0 ? `.${digits.slice(-decimals)}` : '';
  return `${micros < 0 && rounded !== 0 ? '-' : ''}${int}${frac}`;
}

/** Format micros as US dollars, e.g. -$1,234.56. */
export function formatUsd(micros: Micros, decimals = 2): string {
  const plain = formatMicros(micros, decimals);
  const negative = plain.startsWith('-');
  const [int = '0', frac] = (negative ? plain.slice(1) : plain).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}
