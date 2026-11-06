import { toMicros as $, toQuantity as sh } from '@tj/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIbkrActivity } from './ibkr-activity';

const text = readFileSync(new URL('./__fixtures__/ibkr-activity.csv', import.meta.url), 'utf8');
const result = parseIbkrActivity(text);
const pick = ({
  symbol,
  side,
  quantity,
  price,
  commission,
  otherFees,
  executedAt,
}: (typeof result.executions)[number]) => ({
  symbol,
  side,
  quantity,
  price,
  commission,
  otherFees,
  executedAt,
});

describe('parseIbkrActivity', () => {
  it('imports USD stock orders with NY times converted to UTC and positive costs', () => {
    expect(result.executions.map(pick)).toEqual([
      {
        symbol: 'COST',
        side: 'BUY',
        quantity: sh('0.25'),
        price: $('905.12'),
        commission: $('0.25'),
        otherFees: 0,
        executedAt: '2026-06-02T15:20:05.000Z',
      },
      {
        symbol: 'COST',
        side: 'SELL',
        quantity: sh('0.25'),
        price: $('921.4'),
        commission: $('0.25'),
        otherFees: 0,
        executedAt: '2026-06-05T18:02:10.000Z',
      },
      {
        symbol: 'F',
        side: 'BUY',
        quantity: sh(1000),
        price: $('11.5'),
        commission: $('5'),
        otherFees: 0,
        executedAt: '2026-02-10T15:30:00.000Z',
      },
      {
        symbol: 'F',
        side: 'SELL',
        quantity: sh(1000),
        price: $('12'),
        commission: $('5'),
        otherFees: 0,
        executedAt: '2026-02-12T20:00:00.000Z',
      },
      {
        symbol: 'MSFT',
        side: 'BUY',
        quantity: sh(10),
        price: $('400'),
        commission: $('1'),
        otherFees: 0,
        executedAt: '2026-03-02T15:00:00.000Z',
      },
      {
        symbol: 'MSFT',
        side: 'BUY',
        quantity: sh(5),
        price: $('410'),
        commission: $('1'),
        otherFees: 0,
        executedAt: '2026-03-03T15:15:00.000Z',
      },
      // EDT from Mar 8; the USD transaction fee for this fill lands in otherFees.
      {
        symbol: 'MSFT',
        side: 'SELL',
        quantity: sh(15),
        price: $('420'),
        commission: $('1.05'),
        otherFees: $('0.02'),
        executedAt: '2026-03-10T19:45:00.000Z',
      },
      {
        symbol: 'NVDA',
        side: 'BUY',
        quantity: sh(20),
        price: $('180'),
        commission: $('1'),
        otherFees: 0,
        executedAt: '2026-10-14T14:45:00.000Z',
      },
      // IBKR writes share classes with a space; stored as BRK.B
      {
        symbol: 'BRK.B',
        side: 'BUY',
        quantity: sh(2),
        price: $('480'),
        commission: $('1'),
        otherFees: 0,
        executedAt: '2026-07-07T14:00:00.000Z',
      },
      {
        symbol: 'BRK.B',
        side: 'SELL',
        quantity: sh(2),
        price: $('495'),
        commission: $('1'),
        otherFees: 0,
        executedAt: '2026-07-21T19:30:00.000Z',
      },
    ]);
  });

  it('imports USD cash items and leaves totals out', () => {
    expect(
      result.cashFlows.map(({ type, amount, occurredAt }) => ({ type, amount, occurredAt })),
    ).toEqual([
      { type: 'DEPOSIT', amount: $('1000'), occurredAt: '2026-02-02' },
      { type: 'WITHDRAWAL', amount: $('-250'), occurredAt: '2026-09-01' },
      { type: 'DIVIDEND', amount: $('12.45'), occurredAt: '2026-03-26' },
      { type: 'DIVIDEND', amount: $('12.45'), occurredAt: '2026-06-12' },
      { type: 'DIVIDEND', amount: $('-1.87'), occurredAt: '2026-03-26' }, // withholding tax
      { type: 'INTEREST', amount: $('3.21'), occurredAt: '2026-04-03' },
      { type: 'FEE', amount: $('-10'), occurredAt: '2026-04-03' },
      { type: 'FEE', amount: $('-0.5'), occurredAt: '2026-06-01' }, // transaction fee with no matching fill
    ]);
    expect(result.cashFlows[4]!.note).toMatch(/^Withholding tax: MSFT/);
  });

  it('reports skipped rows with a reason and line number', () => {
    const counts = result.issues.reduce<Record<string, number>>((acc, i) => {
      acc[i.reason] = (acc[i.reason] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      'Not a stock (Forex)': 2,
      'Non-USD (HKD)': 2,
      'Non-USD (EUR)': 2,
      'Cancelled trade': 1,
    });
    expect(result.issues.every((i) => i.severity === 'skipped' && i.line > 0)).toBe(true);
  });

  it('gives every row a deterministic fingerprint id for de-duplication', () => {
    const again = parseIbkrActivity(text);
    expect(again.executions.map((e) => e.externalId)).toEqual(
      result.executions.map((e) => e.externalId),
    );
    const ids = [...result.executions, ...result.cashFlows].map((r) => r.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('fp:'))).toBe(true);
  });

  it('numbers identical rows so both are kept', () => {
    const dup = text.replace(
      'Trades,Data,Order,Stocks,USD,NVDA,"2026-10-14, 10:45:00",20,180,182,-3600,-1,3601,0,40,O',
      'Trades,Data,Order,Stocks,USD,NVDA,"2026-10-14, 10:45:00",20,180,182,-3600,-1,3601,0,40,O\n' +
        'Trades,Data,Order,Stocks,USD,NVDA,"2026-10-14, 10:45:00",20,180,182,-3600,-1,3601,0,40,O',
    );
    const nvda = parseIbkrActivity(dup).executions.filter((e) => e.symbol === 'NVDA');
    expect(nvda).toHaveLength(2);
    expect(nvda[0]!.externalId).not.toBe(nvda[1]!.externalId);
  });

  it('reports malformed rows as errors instead of guessing', () => {
    const bad = text.replace('"2026-10-14, 10:45:00",20,180', '"not a date",20,180');
    const r = parseIbkrActivity(bad);
    expect(r.executions.find((e) => e.symbol === 'NVDA')).toBeUndefined();
    expect(r.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', reason: expect.stringMatching(/date/i) }),
    );
  });

  it('rejects a file that is not an Activity Statement', () => {
    expect(() => parseIbkrActivity('a,b,c\n1,2,3')).toThrow(/Activity Statement/);
  });
});
