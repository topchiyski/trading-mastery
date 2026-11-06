import { toMicros as $, toQuantity as sh } from '@tj/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGenericCsv, type CsvMapping } from './generic-csv';

const text = readFileSync(new URL('./__fixtures__/generic.csv', import.meta.url), 'utf8');

const mapping: CsvMapping = {
  columns: {
    date: 'Date',
    time: 'Time',
    side: 'Action',
    symbol: 'Ticker',
    quantity: 'Shares',
    price: 'Price',
    commission: 'Fees',
    externalId: 'Trade ID',
  },
  dateFormat: 'MM/DD/YYYY',
  timeZone: 'America/New_York',
  sideValues: { buy: ['Bought', 'BUY'], sell: ['Sold', 'SELL'] },
};

describe('parseGenericCsv', () => {
  const r = parseGenericCsv(text, mapping);

  it('maps columns to executions', () => {
    expect(
      r.executions.map(({ symbol, side, quantity, price, commission, executedAt, externalId }) => ({
        symbol,
        side,
        quantity,
        price,
        commission,
        executedAt,
        externalId,
      })),
    ).toEqual([
      {
        symbol: 'AMD',
        side: 'BUY',
        quantity: sh(100),
        price: $('160'),
        commission: $('1'),
        executedAt: '2026-03-02T15:00:00.000Z',
        externalId: 'T-1',
      },
      // negative fees are treated as a cost; seconds are kept
      {
        symbol: 'AMD',
        side: 'BUY',
        quantity: sh(50),
        price: $('164.5'),
        commission: $('1'),
        executedAt: '2026-03-03T15:15:30.000Z',
        externalId: 'T-2',
      },
      // symbols are uppercased; NY time after the DST change
      {
        symbol: 'AMD',
        side: 'SELL',
        quantity: sh(150),
        price: $('170.25'),
        commission: $('1.25'),
        executedAt: '2026-03-09T19:30:00.000Z',
        externalId: 'T-3',
      },
      // no time -> 12:00 New York; no id -> fingerprint; share class with a space -> BRK.B
      {
        symbol: 'BRK.B',
        side: 'BUY',
        quantity: sh('0.5'),
        price: $('480'),
        commission: 0,
        executedAt: '2026-03-11T16:00:00.000Z',
        externalId: expect.stringMatching(/^fp:/),
      },
      {
        symbol: 'BRK.B',
        side: 'SELL',
        quantity: sh('0.5'),
        price: $('1490.5'),
        commission: 0,
        executedAt: '2026-03-12T18:00:00.000Z',
        externalId: expect.stringMatching(/^fp:/),
      },
    ]);
  });

  it('reports rows it cannot use with line numbers', () => {
    expect(r.issues).toEqual([
      { line: 5, severity: 'skipped', reason: 'Unknown side "Dividend"' },
      {
        line: 8,
        severity: 'error',
        reason: expect.stringMatching(/date/i),
        detail: expect.any(String),
      },
    ]);
  });

  it('derives the side from the sign of the quantity when there is no side column', () => {
    const csv =
      'when,sym,qty,px\n2026-03-02 10:00:00,AAPL,10,200\n2026-03-04 15:00:00,AAPL,-10,210\n';
    const out = parseGenericCsv(csv, {
      columns: { date: 'when', symbol: 'sym', quantity: 'qty', price: 'px' },
      dateFormat: 'YYYY-MM-DD',
      timeZone: 'UTC',
    });
    expect(out.executions.map((e) => [e.side, e.quantity, e.executedAt])).toEqual([
      ['BUY', sh(10), '2026-03-02T10:00:00.000Z'],
      ['SELL', sh(10), '2026-03-04T15:00:00.000Z'],
    ]);
  });

  it('supports DD/MM/YYYY, DD.MM.YYYY and semicolon files', () => {
    const csv = 'd;s;q;p\n02.03.2026;AAPL;1;200\n';
    const out = parseGenericCsv(csv, {
      delimiter: ';',
      columns: { date: 'd', symbol: 's', quantity: 'q', price: 'p' },
      dateFormat: 'DD.MM.YYYY',
      timeZone: 'America/New_York',
    });
    expect(out.executions[0]!.executedAt).toBe('2026-03-02T17:00:00.000Z');
  });

  it('fails clearly when a mapped column is missing', () => {
    expect(() =>
      parseGenericCsv(text, { ...mapping, columns: { ...mapping.columns, price: 'Cost' } }),
    ).toThrow(/column "Cost" not found/);
  });
});
