import { describe, expect, it } from 'vitest';
import { WEEKDAY_ORDER, breakdownBy, monthOf, weekdayOfEntry } from './breakdown';
import { toMicros as $ } from './money';

interface T {
  symbol: string;
  setup: string | null;
  mistakes: string[];
  openedAt: string;
  closedAt: string;
  netPnl: number;
  rMultiple: number | null;
}

const trades: T[] = [
  // Mon Mar 2 entry
  {
    symbol: 'AAPL',
    setup: 'Breakout',
    mistakes: [],
    openedAt: '2026-03-02T15:00:00Z',
    closedAt: '2026-03-05T20:00:00Z',
    netPnl: $('300'),
    rMultiple: 1.5,
  },
  // Tue Mar 3 entry, two mistakes
  {
    symbol: 'MSFT',
    setup: 'Pullback',
    mistakes: ['Chased entry', 'Moved stop'],
    openedAt: '2026-03-03T15:00:00Z',
    closedAt: '2026-04-01T19:00:00Z',
    netPnl: $('-200'),
    rMultiple: -1,
  },
  // Mon Mar 9 entry
  {
    symbol: 'AAPL',
    setup: 'Breakout',
    mistakes: ['Chased entry'],
    openedAt: '2026-03-09T15:00:00Z',
    closedAt: '2026-03-12T19:00:00Z',
    netPnl: $('-100'),
    rMultiple: null,
  },
  // No setup tag
  {
    symbol: 'NVDA',
    setup: null,
    mistakes: [],
    openedAt: '2026-03-10T15:00:00Z',
    closedAt: '2026-03-11T19:00:00Z',
    netPnl: $('0.5'),
    rMultiple: 0,
  },
];

describe('breakdownBy', () => {
  it('groups by setup with outcome stats per row, sorted by key', () => {
    const rows = breakdownBy(trades, (t) => t.setup);
    expect(rows.map((r) => r.key)).toEqual(['Breakout', 'Pullback']); // null keys are skipped
    expect(rows[0]).toMatchObject({
      count: 2,
      wins: 1,
      losses: 1,
      winRate: 0.5,
      totalNetPnl: $('200'),
      expectancy: $('100'),
      expectancyR: 1.5,
      rExcludedCount: 1,
    });
  });

  it('puts a trade in every group it belongs to (mistake tags) — cost of mistakes', () => {
    const rows = breakdownBy(trades, (t) => t.mistakes);
    expect(rows.map((r) => [r.key, r.count, r.totalNetPnl])).toEqual([
      ['Chased entry', 2, $('-300')],
      ['Moved stop', 1, $('-200')],
    ]);
  });

  it('honours an explicit key order', () => {
    const rows = breakdownBy(trades, (t) => weekdayOfEntry(t.openedAt), { order: WEEKDAY_ORDER });
    expect(rows.map((r) => [r.key, r.count])).toEqual([
      ['Mon', 2],
      ['Tue', 2],
    ]);
  });

  it('places keys missing from the order last, alphabetically', () => {
    const rows = breakdownBy(trades, (t) => t.symbol, { order: ['NVDA'] });
    expect(rows.map((r) => r.key)).toEqual(['NVDA', 'AAPL', 'MSFT']);
  });

  it('applies the break-even threshold', () => {
    const rows = breakdownBy(trades, (t) => t.symbol, { breakEvenThreshold: $('150') });
    expect(rows.find((r) => r.key === 'AAPL')).toMatchObject({ wins: 1, losses: 0, breakEvens: 1 });
  });
});

describe('key helpers', () => {
  it('weekdayOfEntry uses the New York date', () => {
    expect(weekdayOfEntry('2026-03-03T02:00:00Z')).toBe('Mon'); // Mon 21:00 in New York
  });

  it('monthOf uses the New York date', () => {
    expect(monthOf('2026-04-01T02:00:00Z')).toBe('2026-03');
    expect(breakdownBy(trades, (t) => monthOf(t.closedAt)).map((r) => r.key)).toEqual([
      '2026-03',
      '2026-04',
    ]);
  });
});
