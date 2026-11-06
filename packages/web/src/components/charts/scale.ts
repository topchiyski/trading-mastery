import { niceStep } from '@tj/core';

/** Round ticks from at or below `min` to at or above `max`, about `count` intervals. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) {
    const step = niceStep(Math.abs(min) || 1, 5);
    return [min - step, min, min + step];
  }
  const step = niceStep(max - min, count);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v < max + step / 2; v += step) ticks.push(Math.round(v / step) * step || 0);
  if ((ticks.at(-1) ?? max) < max) ticks.push((ticks.at(-1) ?? 0) + step);
  return ticks.map((t) => Math.round(t * 1e9) / 1e9);
}

export function linearScale([d0, d1]: [number, number], [r0, r1]: [number, number]) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/**
 * Diverging fill for P&L-like values: neutral gray at 0, toward blue (gain) or red (loss)
 * in proportion to |value| / maxAbs. Mixed in OKLab by the browser, themeable via CSS vars.
 */
export function divergingFill(value: number, maxAbs: number): { background: string; ink: string } {
  const pct = maxAbs > 0 ? Math.round((Math.min(Math.abs(value), maxAbs) / maxAbs) * 100) : 0;
  if (pct === 0) return { background: 'var(--chart-mid)', ink: 'var(--chart-ink)' };
  const pole = value > 0 ? 'var(--chart-pos-deep)' : 'var(--chart-neg-deep)';
  return {
    background: `color-mix(in oklab, ${pole} ${pct}%, var(--chart-mid))`,
    ink: pct >= 55 ? '#ffffff' : 'var(--chart-ink)',
  };
}
