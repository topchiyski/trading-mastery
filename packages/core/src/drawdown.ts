export interface DrawdownPoint {
  /** Running maximum so far (including the baseline, if given). */
  peak: number;
  /** value − peak, always ≤ 0. */
  drawdown: number;
  /** value ÷ peak − 1 (≤ 0); null when the peak is not positive. */
  drawdownPct: number | null;
}

/** Underwater series. Pass `baseline` (e.g. 0 for cumulative P&L) so an initial loss counts. */
export function drawdownSeries(values: readonly number[], baseline?: number): DrawdownPoint[] {
  let peak = baseline ?? Number.NEGATIVE_INFINITY;
  return values.map((v) => {
    peak = Math.max(peak, v);
    return { peak, drawdown: v - peak, drawdownPct: peak > 0 ? v / peak - 1 : null };
  });
}

export interface MaxDrawdown {
  drawdown: number;
  drawdownPct: number | null;
  /** Index of the peak the drawdown is measured from; −1 means the baseline. */
  peakIndex: number;
  troughIndex: number;
  /** First index after the trough back at or above the peak; null if not recovered. */
  recoveryIndex: number | null;
}

/** The deepest drawdown, ranked by amount (default) or by percent. Null when there is none. */
export function maxDrawdown(
  values: readonly number[],
  opts: { baseline?: number; by?: 'amount' | 'percent' } = {},
): MaxDrawdown | null {
  const byPercent = opts.by === 'percent';
  let peak = opts.baseline ?? Number.NEGATIVE_INFINITY;
  let peakIndex = -1;
  let worst: MaxDrawdown | null = null;
  let worstPeakValue = 0;

  for (const [i, v] of values.entries()) {
    if (v >= peak) {
      peak = v;
      peakIndex = i;
      continue;
    }
    const drawdown = v - peak;
    const drawdownPct = peak > 0 ? v / peak - 1 : null;
    const score = byPercent ? drawdownPct : drawdown;
    const best = byPercent ? (worst?.drawdownPct ?? null) : (worst?.drawdown ?? null);
    if (score !== null && (best === null || score < best)) {
      worst = { drawdown, drawdownPct, peakIndex, troughIndex: i, recoveryIndex: null };
      worstPeakValue = peak;
    }
  }

  if (worst === null) return null;
  const trough = worst.troughIndex;
  const recovery = values.findIndex((v, i) => i > trough && v >= worstPeakValue);
  return { ...worst, recoveryIndex: recovery === -1 ? null : recovery };
}
