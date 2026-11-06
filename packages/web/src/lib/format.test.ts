import { toMicros as $ } from '@tj/core';
import { describe, expect, it } from 'vitest';
import {
  fmtDays,
  fmtMoney,
  fmtNyDate,
  fmtNyDateTime,
  fmtPct,
  fmtPrice,
  fmtQty,
  fmtR,
} from './format';

describe('format', () => {
  it('formats money, with a dash for missing values', () => {
    expect(fmtMoney($('450'))).toBe('$450.00');
    expect(fmtMoney($('-1234.5'))).toBe('-$1,234.50');
    expect(fmtMoney(null)).toBe('—');
  });

  it('formats prices with 2 decimals, or 4 when sub-cent', () => {
    expect(fmtPrice($('54.52'))).toBe('$54.52');
    expect(fmtPrice($('53.825'))).toBe('$53.8250');
    expect(fmtPrice(null)).toBe('—');
  });

  it('formats ratios as percent and R', () => {
    expect(fmtPct(0.09)).toBe('9.00%');
    expect(fmtPct(-0.0505)).toBe('-5.05%');
    expect(fmtPct(null)).toBe('—');
    expect(fmtR(2.25)).toBe('2.25R');
    expect(fmtR(-1)).toBe('-1.00R');
    expect(fmtR(null)).toBe('—');
    // values that round to zero never show a minus sign
    expect(fmtR(-0.0021)).toBe('0.00R');
    expect(fmtPct(-0.00001)).toBe('0.00%');
  });

  it('formats New York dates and times', () => {
    expect(fmtNyDateTime('2026-03-02T15:00:00.000Z')).toBe('2026-03-02 10:00');
    expect(fmtNyDate('2026-03-02T03:00:00.000Z')).toBe('2026-03-01');
    expect(fmtNyDate(null)).toBe('—');
  });

  it('formats holding periods', () => {
    expect(fmtDays({ calendarDays: 3, tradingDays: 1 })).toBe('1d (3 cal)');
    expect(fmtDays({ calendarDays: 2, tradingDays: 2 })).toBe('2d');
    expect(fmtDays(null)).toBe('—');
  });
});

describe('fmtQty', () => {
  it('formats micro-shares as readable shares', () => {
    expect(fmtQty(100_000_000)).toBe('100');
    expect(fmtQty(500_000)).toBe('0.5');
    expect(fmtQty(null)).toBe('—');
  });
});
