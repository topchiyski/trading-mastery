import { describe, expect, it } from 'vitest';
import { toMicros as $ } from './money';
import { formatQuantity, fromQuantity, notional, toQuantity } from './quantity';

describe('quantity (micro-shares)', () => {
  it('parses share amounts exactly, including fractions', () => {
    expect(toQuantity('100')).toBe(100_000_000);
    expect(toQuantity('0.5')).toBe(500_000);
    expect(toQuantity(0.03)).toBe(30_000);
    expect(toQuantity('0.0052')).toBe(5_200);
    expect(fromQuantity(500_000)).toBe(0.5);
  });

  it('formats without trailing zeros', () => {
    expect(formatQuantity(100_000_000)).toBe('100');
    expect(formatQuantity(500_000)).toBe('0.5');
    expect(formatQuantity(5_200)).toBe('0.0052');
    expect(formatQuantity(1_234_500_000)).toBe('1,234.5');
    expect(formatQuantity(-30_000)).toBe('-0.03');
  });

  it('computes shares × price in micros', () => {
    expect(notional(toQuantity('100'), $('50'))).toBe($('5000'));
    expect(notional(toQuantity('0.5'), $('284.1'))).toBe($('142.05'));
    // 0.3 × 0.333333 = 0.0999999 -> rounds to 0.1 (micros)
    expect(notional(toQuantity('0.3'), $('0.333333'))).toBe(100_000);
  });
});
