import { describe, expect, it } from 'vitest';
import { drawdownSeries, maxDrawdown } from './drawdown';

describe('drawdownSeries', () => {
  it('tracks the running peak and distance below it', () => {
    expect(drawdownSeries([100, 120, 90, 110, 130])).toEqual([
      { peak: 100, drawdown: 0, drawdownPct: 0 },
      { peak: 120, drawdown: 0, drawdownPct: 0 },
      { peak: 120, drawdown: -30, drawdownPct: -0.25 },
      { peak: 120, drawdown: -10, drawdownPct: 110 / 120 - 1 },
      { peak: 130, drawdown: 0, drawdownPct: 0 },
    ]);
  });

  it('starts from a baseline peak so an initial loss counts', () => {
    expect(drawdownSeries([-50, 20], 0)).toEqual([
      { peak: 0, drawdown: -50, drawdownPct: null },
      { peak: 20, drawdown: 0, drawdownPct: 0 },
    ]);
  });
});

describe('maxDrawdown', () => {
  it('finds the deepest drawdown and when it recovered', () => {
    expect(maxDrawdown([100, 120, 90, 110, 130])).toEqual({
      drawdown: -30,
      drawdownPct: -0.25,
      peakIndex: 1,
      troughIndex: 2,
      recoveryIndex: 4,
    });
  });

  it('reports an unrecovered drawdown', () => {
    expect(maxDrawdown([100, 80, 90])?.recoveryIndex).toBeNull();
  });

  it('can rank by percent instead of amount', () => {
    const values = [10, 5, 100, 60];
    expect(maxDrawdown(values)).toMatchObject({ drawdown: -40, troughIndex: 3 });
    expect(maxDrawdown(values, { by: 'percent' })).toMatchObject({
      drawdownPct: -0.5,
      troughIndex: 1,
      recoveryIndex: 2,
    });
  });

  it('uses peakIndex −1 for the baseline', () => {
    expect(maxDrawdown([-50, 20], { baseline: 0 })).toMatchObject({
      drawdown: -50,
      peakIndex: -1,
      troughIndex: 0,
      recoveryIndex: 1,
    });
  });

  it('is null when there is no drawdown', () => {
    expect(maxDrawdown([])).toBeNull();
    expect(maxDrawdown([1, 2, 3])).toBeNull();
  });
});
