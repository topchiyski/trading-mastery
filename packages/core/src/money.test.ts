import { describe, expect, it } from 'vitest';
import { formatMicros, formatUsd, fromMicros, mulDiv, toMicros } from './money';

describe('toMicros', () => {
  it('parses decimal strings exactly', () => {
    expect(toMicros('50')).toBe(50_000_000);
    expect(toMicros('0.1')).toBe(100_000);
    expect(toMicros('123.456789')).toBe(123_456_789);
    expect(toMicros('-1.5')).toBe(-1_500_000);
    expect(toMicros('+2.25')).toBe(2_250_000);
    expect(toMicros('.5')).toBe(500_000);
    expect(toMicros('7.')).toBe(7_000_000);
    expect(toMicros(' 3.10 ')).toBe(3_100_000);
  });

  it('rounds beyond 6 decimals half away from zero', () => {
    expect(toMicros('1.0000005')).toBe(1_000_001);
    expect(toMicros('1.0000004')).toBe(1_000_000);
    expect(toMicros('-1.0000005')).toBe(-1_000_001);
  });

  it('accepts numbers without float drift', () => {
    expect(toMicros(0.1 + 0.2)).toBe(300_000);
    expect(toMicros(19.99)).toBe(19_990_000);
    expect(toMicros(-0.000001)).toBe(-1);
    expect(toMicros(1e-7)).toBe(0);
  });

  it('rejects garbage', () => {
    expect(() => toMicros('abc')).toThrow(RangeError);
    expect(() => toMicros('')).toThrow(RangeError);
    expect(() => toMicros('.')).toThrow(RangeError);
    expect(() => toMicros('1,000')).toThrow(RangeError);
    expect(() => toMicros(Number.NaN)).toThrow(RangeError);
    expect(() => toMicros(Infinity)).toThrow(RangeError);
    expect(() => toMicros('99999999999999999')).toThrow(RangeError);
  });
});

describe('fromMicros', () => {
  it('converts back to units', () => {
    expect(fromMicros(1_500_000)).toBe(1.5);
  });
});

describe('mulDiv', () => {
  it('computes a*b/c with half-away-from-zero rounding', () => {
    expect(mulDiv(10, 1, 4)).toBe(3); // 2.5 -> 3
    expect(mulDiv(-10, 1, 4)).toBe(-3); // -2.5 -> -3
    expect(mulDiv(10, 1, -4)).toBe(-3);
    expect(mulDiv(7, 1, 3)).toBe(2); // 2.33 -> 2
    expect(mulDiv(12_400_000_000, 1, 300)).toBe(41_333_333);
  });

  it('does not overflow on large intermediates', () => {
    // 1e13 * 1e4 = 1e17 exceeds 2^53, the result does not
    expect(mulDiv(10_000_000_000_000, 10_000, 20_000)).toBe(5_000_000_000_000);
  });

  it('rejects division by zero, non-integers and unsafe results', () => {
    expect(() => mulDiv(1, 1, 0)).toThrow(RangeError);
    expect(() => mulDiv(1.5, 1, 1)).toThrow(RangeError);
    expect(() => mulDiv(Number.MAX_SAFE_INTEGER, 2, 1)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('formats micros as fixed decimals', () => {
    expect(formatMicros(41_333_333)).toBe('41.33');
    expect(formatMicros(41_333_333, 4)).toBe('41.3333');
    expect(formatMicros(-1_005_000)).toBe('-1.01');
    expect(formatMicros(-4_000)).toBe('0.00'); // no negative zero
    expect(formatMicros(5_000_000, 0)).toBe('5');
    expect(formatMicros(1, 6)).toBe('0.000001');
  });

  it('formats USD with thousands separators', () => {
    expect(formatUsd(1_234_567_890_000)).toBe('$1,234,567.89');
    expect(formatUsd(-202_000_000)).toBe('-$202.00');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('rejects unsupported decimals', () => {
    expect(() => formatMicros(1, 7)).toThrow(RangeError);
  });
});
