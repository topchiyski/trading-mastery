import { groupExecutions, type Execution } from '@tj/core';
import { count, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import {
  executions,
  screenshots,
  stopChanges,
  tradeExecutions,
  trades,
  tradeTags,
  type ExecutionRow,
  type TradeRow,
} from '../db/schema';
import { DomainError } from '../errors';

export function toCoreExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    commission: row.commission,
    otherFees: row.otherFees,
    executedAt: row.executedAt,
    externalId: row.externalId,
  };
}

/** True when a trade row carries anything the user wrote or attached. */
export function hasJournalData(db: DbOrTx, row: TradeRow): boolean {
  const fields = [
    row.initialStop,
    row.plannedRiskOverride,
    row.target,
    row.setupTagId,
    row.thesis,
    row.review,
    row.emotion,
    row.executionRating,
    row.followedPlan,
  ];
  if (fields.some((v) => v !== null && v !== '')) return true;
  const children = [
    db.select({ n: count() }).from(stopChanges).where(eq(stopChanges.tradeId, row.id)).get(),
    db.select({ n: count() }).from(tradeTags).where(eq(tradeTags.tradeId, row.id)).get(),
    db.select({ n: count() }).from(screenshots).where(eq(screenshots.tradeId, row.id)).get(),
  ];
  return children.some((c) => (c?.n ?? 0) > 0);
}

/**
 * Rebuild all trades of one symbol from its executions. Must run inside a transaction:
 * throws a 422 DomainError (rolling back the caller's change) if the executions don't
 * form a valid long-only sequence.
 *
 * Journal data lives on trade rows, which are matched to new groups by stable key:
 * a row whose stable-key execution falls in a group is a candidate for that group.
 * The best candidate is kept (and re-keyed to the group's first execution), so journal
 * data survives an earlier fill being inserted. Unmatched rows with journal data are
 * flagged orphaned, never deleted; empty ones are removed.
 *
 * Returns execution id -> trade row id for the symbol.
 */
export function regroupSymbol(db: DbOrTx, symbol: string): Map<number, number> {
  const rows = db.select().from(executions).where(eq(executions.symbol, symbol)).all();
  const { trades: groups, errors } = groupExecutions(rows.map(toCoreExecution));
  const first = errors[0];
  if (first) throw new DomainError(422, first.code, first.message, { errors });

  const existing = db.select().from(trades).where(eq(trades.symbol, symbol)).all();
  // Each row's executions before this regroup, for the fallback match below.
  const previous = new Map<number, number[]>();
  if (existing.length > 0) {
    const ids = existing.map((r) => r.id);
    for (const link of db
      .select()
      .from(tradeExecutions)
      .where(inArray(tradeExecutions.tradeId, ids))
      .all()) {
      previous.set(link.tradeId, [...(previous.get(link.tradeId) ?? []), link.executionId]);
    }
    db.delete(tradeExecutions).where(inArray(tradeExecutions.tradeId, ids)).run();
  }

  const groupOfExecution = new Map<number, number>();
  groups.forEach((g, gi) => g.executions.forEach((e) => groupOfExecution.set(e.id, gi)));
  const candidates = groups.map((): TradeRow[] => []);
  const leftover: TradeRow[] = [];
  for (const row of existing) {
    let gi = groupOfExecution.get(row.stableKey);
    if (gi === undefined) {
      // The stable-key execution is gone (e.g. the first fill was deleted): fall back to the
      // group holding most of the row's previous executions.
      const votes = new Map<number, number>();
      for (const id of previous.get(row.id) ?? []) {
        const g = groupOfExecution.get(id);
        if (g !== undefined) votes.set(g, (votes.get(g) ?? 0) + 1);
      }
      gi = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    }
    if (gi === undefined) leftover.push(row);
    else candidates[gi]?.push(row);
  }

  const now = new Date().toISOString();
  const tradeOfExecution = new Map<number, number>();

  groups.forEach((group, gi) => {
    // Prefer the row already keyed to this group, then one with journal data, then the oldest key.
    const ranked = (candidates[gi] ?? [])
      .map((row) => ({ row, journal: hasJournalData(db, row) }))
      .sort(
        (a, b) =>
          Number(b.row.stableKey === group.stableKey) -
            Number(a.row.stableKey === group.stableKey) ||
          Number(b.journal) - Number(a.journal) ||
          a.row.stableKey - b.row.stableKey,
      );
    const [keep, ...rest] = ranked;
    leftover.push(...rest.map((r) => r.row));

    const values = {
      stableKey: group.stableKey,
      status: group.status,
      openedAt: group.openedAt,
      closedAt: group.closedAt,
      orphanedAt: null,
      updatedAt: now,
    };
    let tradeId: number;
    if (keep) {
      db.update(trades).set(values).where(eq(trades.id, keep.row.id)).run();
      tradeId = keep.row.id;
    } else {
      tradeId = db
        .insert(trades)
        .values({ ...values, symbol, direction: group.direction })
        .returning({ id: trades.id })
        .get().id;
    }
    db.insert(tradeExecutions)
      .values(group.executions.map((e) => ({ tradeId, executionId: e.id })))
      .run();
    for (const e of group.executions) tradeOfExecution.set(e.id, tradeId);
  });

  for (const row of leftover) {
    if (hasJournalData(db, row)) {
      if (row.orphanedAt === null) {
        db.update(trades)
          .set({ orphanedAt: now, updatedAt: now })
          .where(eq(trades.id, row.id))
          .run();
      }
    } else {
      db.delete(trades).where(eq(trades.id, row.id)).run();
    }
  }

  return tradeOfExecution;
}
