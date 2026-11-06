import { describe, expect, it } from 'vitest';
import { divergingFill, linearScale, niceTicks } from './scale';

describe('niceTicks', () => {
  it('returns round ticks covering the domain', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-3.2, 2.1, 5)).toEqual([-4, -2, 0, 2, 4]); // 5.3 / 5 -> step 2
    expect(niceTicks(10_000, 15_500, 4)).toEqual([10_000, 12_000, 14_000, 16_000]);
  });

  it('handles a flat domain', () => {
    expect(niceTicks(5, 5, 4)).toEqual([4, 5, 6]);
  });
});

describe('linearScale', () => {
  it('maps domain to range (y grows downwards)', () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
    expect(y(100)).toBe(0);
  });
});

describe('divergingFill', () => {
  it('mixes from the neutral midpoint toward the sign pole', () => {
    expect(divergingFill(0, 100)).toEqual({
      background: 'var(--chart-mid)',
      ink: 'var(--chart-ink)',
    });
    expect(divergingFill(100, 100).background).toBe(
      'color-mix(in oklab, var(--chart-pos-deep) 100%, var(--chart-mid))',
    );
    expect(divergingFill(-25, 100).background).toBe(
      'color-mix(in oklab, var(--chart-neg-deep) 25%, var(--chart-mid))',
    );
  });

  it('switches to light ink on deep fills', () => {
    expect(divergingFill(90, 100).ink).toBe('#ffffff');
    expect(divergingFill(30, 100).ink).toBe('var(--chart-ink)');
  });
});
