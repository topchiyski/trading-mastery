import { describe, expect, it } from 'vitest';
import { guessMapping } from './mapping';

describe('guessMapping', () => {
  it('maps common header names', () => {
    expect(
      guessMapping(['Date', 'Time', 'Action', 'Ticker', 'Shares', 'Price', 'Fees', 'Trade ID'])
        .columns,
    ).toEqual({
      date: 'Date',
      time: 'Time',
      side: 'Action',
      symbol: 'Ticker',
      quantity: 'Shares',
      price: 'Price',
      commission: 'Fees',
      externalId: 'Trade ID',
    });
  });

  it('handles combined date/time columns and broker-style names', () => {
    expect(
      guessMapping([
        'Symbol',
        'Date/Time',
        'Quantity',
        'T. Price',
        'Comm/Fee',
        'Buy/Sell',
        'IBExecID',
      ]).columns,
    ).toEqual({
      symbol: 'Symbol',
      date: 'Date/Time',
      quantity: 'Quantity',
      price: 'T. Price',
      commission: 'Comm/Fee',
      side: 'Buy/Sell',
      externalId: 'IBExecID',
    });
  });

  it('guesses the date format from sample values', () => {
    expect(guessMapping(['Date'], [['03/27/2026']]).dateFormat).toBe('MM/DD/YYYY');
    expect(guessMapping(['Date'], [['27/03/2026']]).dateFormat).toBe('DD/MM/YYYY');
    expect(guessMapping(['Date'], [['27.03.2026']]).dateFormat).toBe('DD.MM.YYYY');
    expect(guessMapping(['Date'], [['2026-03-27 10:00']]).dateFormat).toBe('YYYY-MM-DD');
  });

  it('leaves unknown columns unmapped', () => {
    expect(guessMapping(['foo', 'bar']).columns).toEqual({});
  });
});
