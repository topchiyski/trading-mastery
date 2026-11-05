import { describe, expect, it } from 'vitest';
import { at, fill } from './__fixtures__/fill';
import { compareExecutions, groupExecutions, isValidTicker, validateExecution } from './grouping';

const ids = (trade: { executions: { id: number }[] }) => trade.executions.map((e) => e.id);

describe('groupExecutions', () => {
  it('groups a single entry and exit into one closed trade', () => {
    const { trades, errors } = groupExecutions([
      fill('BUY', 100, '50', at(2), { id: 1 }),
      fill('SELL', 100, '55', at(4), { id: 2 }),
    ]);
    expect(errors).toEqual([]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      stableKey: 1,
      symbol: 'AAPL',
      direction: 'LONG',
      status: 'CLOSED',
      openedAt: at(2),
      closedAt: at(4),
    });
  });

  it('treats later buys as scale-ins and sells as scale-outs until flat', () => {
    const { trades } = groupExecutions([
      fill('BUY', 100, '10', at(2), { id: 1 }),
      fill('SELL', 50, '12', at(3), { id: 2 }),
      fill('BUY', 50, '14', at(4), { id: 3 }),
      fill('SELL', 100, '13', at(5), { id: 4 }),
    ]);
    expect(trades).toHaveLength(1);
    expect(ids(trades[0]!)).toEqual([1, 2, 3, 4]);
    expect(trades[0]!.status).toBe('CLOSED');
  });

  it('opens a new trade after the position returns to zero', () => {
    const { trades } = groupExecutions([
      fill('BUY', 100, '10', at(2), { id: 1 }),
      fill('SELL', 100, '11', at(3), { id: 2 }),
      fill('BUY', 10, '12', at(4), { id: 3 }),
    ]);
    expect(trades.map((t) => [t.stableKey, t.status])).toEqual([
      [1, 'CLOSED'],
      [3, 'OPEN'],
    ]);
    expect(trades[1]!.closedAt).toBeNull();
  });

  it('processes each symbol independently and sorts trades by open time', () => {
    const { trades } = groupExecutions([
      fill('BUY', 10, '100', at(3), { id: 1, symbol: 'MSFT' }),
      fill('BUY', 10, '50', at(2), { id: 2, symbol: 'AAPL' }),
      fill('SELL', 10, '101', at(4), { id: 3, symbol: 'MSFT' }),
    ]);
    expect(trades.map((t) => [t.symbol, t.status])).toEqual([
      ['AAPL', 'OPEN'],
      ['MSFT', 'CLOSED'],
    ]);
  });

  it('orders executions chronologically regardless of input order', () => {
    const { trades, errors } = groupExecutions([
      fill('SELL', 100, '11', at(5), { id: 1 }),
      fill('BUY', 100, '10', at(2), { id: 2 }),
    ]);
    expect(errors).toEqual([]);
    expect(trades[0]!.stableKey).toBe(2);
  });

  it('reports a sell exceeding the position as an error and does not clip it', () => {
    const { trades, errors } = groupExecutions([
      fill('BUY', 100, '10', at(2), { id: 1 }),
      fill('SELL', 150, '11', at(3), { id: 2 }),
    ]);
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'SELL_EXCEEDS_POSITION',
        executionId: 2,
        positionBefore: 100,
        sellQuantity: 150,
      }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.status).toBe('OPEN');
    expect(ids(trades[0]!)).toEqual([1]);
  });

  it('reports a sell while flat as an error', () => {
    const { trades, errors } = groupExecutions([fill('SELL', 10, '11', at(2), { id: 7 })]);
    expect(trades).toEqual([]);
    expect(errors[0]).toMatchObject({ code: 'SELL_EXCEEDS_POSITION', positionBefore: 0 });
  });

  it('reports invalid executions and skips them', () => {
    const { trades, errors } = groupExecutions([
      fill('BUY', 0, '10', at(2), { id: 1 }),
      fill('BUY', 5, '10', at(2), { id: 2 }),
    ]);
    expect(errors).toEqual([
      expect.objectContaining({ code: 'INVALID_EXECUTION', executionId: 1 }),
    ]);
    expect(trades[0]!.stableKey).toBe(2);
  });

  describe('same-timestamp ordering', () => {
    it('breaks ties by broker execution id before insertion order', () => {
      // Sorted by id the SELL would come first and fail; by exec id the BUY comes first.
      const { trades, errors } = groupExecutions([
        fill('SELL', 100, '11', at(2), { id: 5, externalId: '0000e1b2.0002' }),
        fill('BUY', 100, '10', at(2), { id: 9, externalId: '0000e1b2.0001' }),
      ]);
      expect(errors).toEqual([]);
      expect(ids(trades[0]!)).toEqual([9, 5]);
      expect(trades[0]!.status).toBe('CLOSED');
    });

    it('falls back to insertion order (id) without broker ids', () => {
      const { trades, errors } = groupExecutions([
        fill('SELL', 100, '11', at(2), { id: 2 }),
        fill('BUY', 100, '10', at(2), { id: 1 }),
      ]);
      expect(errors).toEqual([]);
      expect(ids(trades[0]!)).toEqual([1, 2]);
    });

    it('is deterministic regardless of input order', () => {
      const execs = [
        fill('BUY', 100, '10', at(2), { id: 1 }),
        fill('BUY', 100, '10', at(2), { id: 2, externalId: 'B' }),
        fill('BUY', 100, '10', at(2), { id: 3, externalId: 'A' }),
      ];
      const forward = ids(groupExecutions(execs).trades[0]!);
      const backward = ids(groupExecutions([...execs].reverse()).trades[0]!);
      expect(forward).toEqual([3, 2, 1]); // broker ids first (A, B), then ids without broker id
      expect(backward).toEqual(forward);
    });
  });
});

describe('compareExecutions', () => {
  it('compares by time first', () => {
    const a = fill('BUY', 1, '1', at(2), { id: 9 });
    const b = fill('BUY', 1, '1', at(3), { id: 1 });
    expect(compareExecutions(a, b)).toBeLessThan(0);
    expect(compareExecutions(b, a)).toBeGreaterThan(0);
  });
});

describe('validateExecution', () => {
  it('accepts a well-formed execution', () => {
    expect(validateExecution(fill('BUY', 100, '10', at(2)))).toEqual([]);
  });

  it('flags every invalid field', () => {
    const bad = {
      ...fill('BUY', 1.5, '0', 'yesterday', { symbol: 'aapl' }),
      commission: -1,
      otherFees: -1,
      side: 'SHORT' as 'BUY',
    };
    const problems = validateExecution(bad);
    expect(problems).toHaveLength(7);
  });
});

describe('isValidTicker', () => {
  it.each(['AAPL', 'F', 'BRK.B', 'BF-B', 'GOOGL'])('accepts %s', (t) => {
    expect(isValidTicker(t)).toBe(true);
  });
  it.each(['aapl', '', '1ABC', 'TOOLONGX', 'BRK..B', 'A B'])('rejects %s', (t) => {
    expect(isValidTicker(t)).toBe(false);
  });
});
