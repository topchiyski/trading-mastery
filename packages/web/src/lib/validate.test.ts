import { toMicros as $ } from '@tj/core';
import { describe, expect, it } from 'vitest';
import { parseMoneyInput, parseSharesInput, validateFill, validateNewTrade } from './validate';

describe('parseMoneyInput', () => {
  it('parses dollars to micros, tolerating $ and thousands separators', () => {
    expect(parseMoneyInput('50')).toEqual({ value: $('50') });
    expect(parseMoneyInput(' $1,234.50 ')).toEqual({ value: $('1234.5') });
    expect(parseMoneyInput('')).toEqual({ value: null });
    expect(parseMoneyInput('abc')).toEqual({ error: 'Enter a number' });
  });
});

describe('parseSharesInput', () => {
  it('requires a positive whole number', () => {
    expect(parseSharesInput('100')).toEqual({ value: 100 });
    expect(parseSharesInput('')).toEqual({ value: null });
    expect(parseSharesInput('1.5')).toEqual({ error: 'Whole shares only' });
    expect(parseSharesInput('0')).toEqual({ error: 'Must be at least 1' });
  });
});

const base = {
  symbol: 'AMD',
  date: '2026-03-02',
  time: '10:00',
  shares: '100',
  price: '50',
  commission: '1',
  initialStop: '48',
  target: '56',
};

describe('validateNewTrade', () => {
  it('returns the API payload and a risk preview when valid', () => {
    const r = validateNewTrade(base);
    expect(r.errors).toEqual({});
    expect(r.payload).toEqual({
      symbol: 'AMD',
      fill: {
        quantity: 100,
        price: $('50'),
        commission: $('1'),
        otherFees: 0,
        executedAt: '2026-03-02T15:00:00.000Z',
      },
      initialStop: $('48'),
      target: $('56'),
    });
    expect(r.preview).toEqual({ risk: $('200'), rewardRisk: 3 });
  });

  it('flags each invalid field', () => {
    const r = validateNewTrade({
      ...base,
      symbol: 'AMD!',
      shares: '0',
      price: '',
      initialStop: 'x',
      time: '',
    });
    expect(Object.keys(r.errors).sort()).toEqual([
      'initialStop',
      'price',
      'shares',
      'symbol',
      'time',
    ]);
    expect(r.payload).toBeNull();
  });

  it('requires the stop below the entry price', () => {
    const r = validateNewTrade({ ...base, initialStop: '50' });
    expect(r.errors.initialStop).toBe('Stop must be below the entry price');
  });

  it('allows trades without stop or target', () => {
    const r = validateNewTrade({ ...base, initialStop: '', target: '' });
    expect(r.errors).toEqual({});
    expect(r.payload?.initialStop).toBeNull();
    expect(r.preview).toEqual({ risk: null, rewardRisk: null });
  });
});

describe('validateFill', () => {
  const fill = {
    side: 'SELL' as const,
    date: '2026-03-04',
    time: '15:30',
    shares: '60',
    price: '55',
    commission: '1',
  };

  it('builds the payload', () => {
    expect(validateFill(fill, 100)).toEqual({
      errors: {},
      payload: {
        side: 'SELL',
        quantity: 60,
        price: $('55'),
        commission: $('1'),
        otherFees: 0,
        executedAt: '2026-03-04T20:30:00.000Z',
      },
    });
  });

  it('prevents selling more than the open position', () => {
    expect(validateFill({ ...fill, shares: '101' }, 100).errors.shares).toBe(
      'Only 100 shares are open',
    );
    expect(validateFill({ ...fill, side: 'BUY', shares: '101' }, 100).errors).toEqual({});
  });
});
