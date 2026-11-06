import { describe, expect, it } from 'vitest';
import { histogram, niceStep } from './histogram';

describe('niceStep', () => {
  it('rounds a raw step up to 1, 2 or 5 × 10^k', () => {
    expect(niceStep(10, 10)).toBe(1);
    expect(niceStep(10, 4)).toBe(5); // 2.5 -> 5
    expect(niceStep(1234, 10)).toBe(200); // 123.4 -> 200
    expect(niceStep(0.37, 8)).toBe(0.05);
    expect(niceStep(0, 10)).toBe(1);
  });
});

describe('histogram', () => {
  it('counts values into fixed-width bins aligned to multiples of the width', () => {
    // R-multiples in 0.5R bins: [-1,-0.5) [-0.5,0) [0,0.5) [0.5,1) [1,1.5) [1.5,2) [2,2.5)
    expect(histogram([-1, -0.4, 0, 0.2, 2.49, 1.5], 0.5)).toEqual([
      { from: -1, to: -0.5, count: 1 },
      { from: -0.5, to: 0, count: 1 },
      { from: 0, to: 0.5, count: 2 },
      { from: 0.5, to: 1, count: 0 },
      { from: 1, to: 1.5, count: 0 },
      { from: 1.5, to: 2, count: 1 },
      { from: 2, to: 2.5, count: 1 },
    ]);
  });

  it('is empty for no values and has one bin for identical values', () => {
    expect(histogram([], 1)).toEqual([]);
    expect(histogram([3, 3], 1)).toEqual([{ from: 3, to: 4, count: 2 }]);
  });

  it('avoids floating-point drift in bin edges', () => {
    const bins = histogram([0.1, 0.7], 0.1);
    expect(bins.map((b) => b.from)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(bins.at(-1)).toEqual({ from: 0.7, to: 0.8, count: 1 });
  });

  it('rejects a non-positive width', () => {
    expect(() => histogram([1], 0)).toThrow(RangeError);
  });
});
