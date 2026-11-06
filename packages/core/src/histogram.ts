export interface Bin {
  /** Inclusive lower edge. */
  from: number;
  /** Exclusive upper edge. */
  to: number;
  count: number;
}

const clean = (n: number) => Math.round(n * 1e9) / 1e9;

/** A "nice" step (1, 2 or 5 × 10^k) splitting `range` into about `target` parts. */
export function niceStep(range: number, target: number): number {
  const raw = range / target;
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return clean(nice * base);
}

/**
 * Fixed-width histogram. Bin edges are multiples of `width` (so 0 is always an edge),
 * every bin between the smallest and largest value is returned, empty ones included.
 */
export function histogram(values: readonly number[], width: number): Bin[] {
  if (!(width > 0)) throw new RangeError('Bin width must be positive');
  if (values.length === 0) return [];
  // The epsilon keeps 0.7 / 0.1 = 6.9999… in bin 7.
  const index = (v: number) => Math.floor(v / width + 1e-9);
  const lo = Math.min(...values.map(index));
  const hi = Math.max(...values.map(index));
  const bins: Bin[] = [];
  for (let k = lo; k <= hi; k++) {
    bins.push({ from: clean(k * width), to: clean((k + 1) * width), count: 0 });
  }
  for (const v of values) {
    const bin = bins[index(v) - lo];
    if (bin) bin.count++;
  }
  return bins;
}
