import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client';
import { listCashFlows } from '../repo/cash-flows';
import { getSettings } from '../repo/settings';
import { getTradeDetail, listTrades } from '../repo/trades';
import { seedDemo } from './demo';

function seeded() {
  const database = openDatabase(':memory:');
  seedDemo(database.db);
  return database;
}

describe('seedDemo', () => {
  it('loads about 40 trades plus settings, tags and cash flows', () => {
    const { db, close } = seeded();
    const { trades, totals } = listTrades(db);
    expect(trades.length).toBeGreaterThanOrEqual(38);
    expect(trades.length).toBeLessThanOrEqual(45);
    expect(totals.openCount).toBeGreaterThanOrEqual(2);
    expect(totals.wins).toBeGreaterThan(5);
    expect(totals.losses).toBeGreaterThan(5);
    expect(getSettings(db).startingBalance).toBeGreaterThan(0);
    expect(listCashFlows(db).map((c) => c.type)).toEqual(
      expect.arrayContaining(['DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'INTEREST', 'FEE']),
    );
    close();
  });

  it('covers the Phase 1 edge cases', () => {
    const { db, close } = seeded();
    const { trades } = listTrades(db);
    const details = trades.map((t) => getTradeDetail(db, t.id));
    const sides = (d: (typeof details)[number]) => d.executions.map((e) => e.side).join(',');

    // scale-in 3 fills then single exit
    expect(details.some((d) => sides(d) === 'BUY,BUY,BUY,SELL')).toBe(true);
    // single entry then 3 scale-outs
    expect(details.some((d) => sides(d) === 'BUY,SELL,SELL,SELL')).toBe(true);
    // interleaved scale-in and scale-out
    expect(details.some((d) => /BUY,SELL,BUY/.test(sides(d)))).toBe(true);
    // fees turning a gross win into a net loss
    expect(details.some((d) => (d.grossPnl ?? 0) > 0 && (d.netPnl ?? 0) < 0)).toBe(true);
    // break-even trade
    expect(trades.some((t) => t.outcome === 'BREAKEVEN')).toBe(true);
    // closed trades without a stop (excluded from R)
    expect(
      trades.filter((t) => t.status === 'CLOSED' && t.rMultiple === null).length,
    ).toBeGreaterThanOrEqual(2);
    // same-timestamp fills
    expect(
      details.some(
        (d) => new Set(d.executions.map((e) => e.executedAt)).size < d.executions.length,
      ),
    ).toBe(true);
    // planned-risk override, trailing stops, open trade with a partial exit, same-day trade
    expect(details.some((d) => d.journal.plannedRiskOverride !== null)).toBe(true);
    expect(details.some((d) => d.stops.length >= 3)).toBe(true);
    expect(details.some((d) => d.status === 'OPEN' && (d.realisations.length ?? 0) > 0)).toBe(true);
    expect(trades.some((t) => t.holding?.calendarDays === 0 && t.status === 'CLOSED')).toBe(true);
    // journal content and mistake tags
    expect(details.filter((d) => d.journal.review).length).toBeGreaterThan(10);
    expect(details.some((d) => d.tags.some((tag) => tag.kind === 'MISTAKE'))).toBe(true);
    close();
  });

  it('is deterministic', () => {
    const a = seeded();
    const b = seeded();
    const strip = (db: typeof a.db) =>
      listTrades(db).trades.map(({ holding: _h, ...rest }) => rest);
    expect(strip(a.db)).toEqual(strip(b.db));
    a.close();
    b.close();
  });

  it('refuses to seed a database that already has executions', () => {
    const { db, close } = seeded();
    expect(() => seedDemo(db)).toThrow(/not empty/);
    close();
  });
});
