/**
 * Import pipeline: upload -> parse -> preview -> commit -> (undo).
 *
 * A preview is a dry run: new rows are inserted and their symbols regrouped inside a
 * transaction that is always rolled back, so the preview shows exactly which trades would
 * be created or changed and which rows would break the long-only position. The parsed
 * rows are stored on the batch, so commit inserts exactly what was previewed.
 */
import { createHash } from 'node:crypto';
import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import {
  cashFlows,
  executions,
  importBatches,
  tradeExecutions,
  type ImportBatchRow,
} from '../db/schema';
import { DomainError, conflict, notFound } from '../errors';
import type { ParseResult, ParsedCashFlow, ParsedExecution } from '../import/types';
import { regroupSymbol } from './regroup';
import { listTrades } from './trades';

export type ImportSource = ImportBatchRow['source'];

class Rollback extends Error {}

/** Values already present in a UNIQUE external-id column (queried in chunks). */
function existingIds(
  db: DbOrTx,
  table: typeof executions | typeof cashFlows,
  ids: string[],
): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of db
      .select({ id: table.externalId })
      .from(table)
      .where(inArray(table.externalId, chunk))
      .all()) {
      if (r.id) found.add(r.id);
    }
  }
  return found;
}

/** Insert rows; returns new execution id -> source line. */
function insertRows(
  tx: DbOrTx,
  execs: ParsedExecution[],
  flows: ParsedCashFlow[],
  source: ImportSource,
  batchId: number | null,
): Map<number, number> {
  const lineOf = new Map<number, number>();
  for (const e of execs) {
    const { id } = tx
      .insert(executions)
      .values({
        symbol: e.symbol,
        side: e.side,
        quantity: e.quantity,
        price: e.price,
        commission: e.commission,
        otherFees: e.otherFees,
        executedAt: e.executedAt,
        externalId: e.externalId,
        source,
        importBatchId: batchId,
      })
      .returning({ id: executions.id })
      .get();
    lineOf.set(id, e.line);
  }
  for (const c of flows) {
    tx.insert(cashFlows)
      .values({
        type: c.type,
        amount: c.amount,
        occurredAt: c.occurredAt,
        note: c.note,
        externalId: c.externalId,
        importBatchId: batchId,
      })
      .run();
  }
  return lineOf;
}

export interface TradeChange {
  id: number;
  symbol: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  fills: number;
  netPnl: number | null;
}

function tradeState(db: DbOrTx, symbols: Set<string>): Map<number, TradeChange> {
  const trades = listTrades(db, { orphaned: 'include' }).trades.filter((t) =>
    symbols.has(t.symbol),
  );
  const ids = trades.map((t) => t.id);
  const fills = new Map<number, number>();
  if (ids.length > 0) {
    for (const r of db
      .select({ tradeId: tradeExecutions.tradeId, n: count() })
      .from(tradeExecutions)
      .where(inArray(tradeExecutions.tradeId, ids))
      .groupBy(tradeExecutions.tradeId)
      .all()) {
      fills.set(r.tradeId, r.n);
    }
  }
  return new Map(
    trades.map((t) => [
      t.id,
      {
        id: t.id,
        symbol: t.symbol,
        status: t.status,
        openedAt: t.openedAt,
        closedAt: t.closedAt,
        fills: fills.get(t.id) ?? 0,
        netPnl: t.netPnl,
      },
    ]),
  );
}

/** Regroup each symbol; collect long-only violations per source line instead of throwing. */
function regroupCollecting(
  tx: DbOrTx,
  symbols: Set<string>,
  lineOf: Map<number, number>,
  newExecs: ParsedExecution[],
): Map<number, string> {
  const errorsByLine = new Map<number, string>();
  for (const symbol of symbols) {
    try {
      regroupSymbol(tx, symbol);
    } catch (err) {
      if (!(err instanceof DomainError) || err.status !== 422) throw err;
      const errors =
        (err.details as { errors?: { executionId: number; message: string }[] } | undefined)
          ?.errors ?? [];
      for (const e of errors) {
        const line = lineOf.get(e.executionId);
        if (line !== undefined) errorsByLine.set(line, e.message);
        else {
          // An existing fill broke because of the new rows: flag the symbol's new rows.
          for (const n of newExecs) if (n.symbol === symbol) errorsByLine.set(n.line, e.message);
        }
      }
    }
  }
  return errorsByLine;
}

/** Dry-run analysis of parsed rows against the current database (nothing is written). */
function analyse(db: Db, source: ImportSource, result: ParseResult) {
  const dupExec = existingIds(
    db,
    executions,
    result.executions.map((e) => e.externalId),
  );
  const dupCash = existingIds(
    db,
    cashFlows,
    result.cashFlows.map((c) => c.externalId),
  );
  const newExecs = result.executions.filter((e) => !dupExec.has(e.externalId));
  const newCash = result.cashFlows.filter((c) => !dupCash.has(c.externalId));
  const symbols = new Set(newExecs.map((e) => e.symbol));

  let errorsByLine = new Map<number, string>();
  let before = new Map<number, TradeChange>();
  let after = new Map<number, TradeChange>();
  try {
    db.transaction((tx) => {
      before = tradeState(tx, symbols);
      const lineOf = insertRows(tx, newExecs, newCash, source, null);
      errorsByLine = regroupCollecting(tx, symbols, lineOf, newExecs);
      after = tradeState(tx, symbols);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }

  const created: TradeChange[] = [];
  const changed: TradeChange[] = [];
  if (errorsByLine.size === 0) {
    for (const [id, t] of after) {
      const prev = before.get(id);
      if (!prev) created.push(t);
      else if (JSON.stringify(prev) !== JSON.stringify(t)) changed.push(t);
    }
  }

  const execRows = result.executions.map((e) => {
    const error = errorsByLine.get(e.line);
    const status = dupExec.has(e.externalId) ? 'duplicate' : error ? 'error' : 'new';
    return { ...e, status, ...(error ? { error } : {}) } as ParsedExecution & {
      status: 'new' | 'duplicate' | 'error';
      error?: string;
    };
  });
  const cashRows = result.cashFlows.map((c) => ({
    ...c,
    status: (dupCash.has(c.externalId) ? 'duplicate' : 'new') as 'new' | 'duplicate',
  }));
  const countOf = (s: string) => execRows.filter((r) => r.status === s).length;

  return {
    summary: {
      executions: { new: countOf('new'), duplicate: countOf('duplicate'), error: countOf('error') },
      cashFlows: { new: newCash.length, duplicate: result.cashFlows.length - newCash.length },
      skipped: result.issues.filter((i) => i.severity === 'skipped').length,
      errors: result.issues.filter((i) => i.severity === 'error').length,
      warnings: result.issues.filter((i) => i.severity === 'warning').length,
    },
    /** Unreadable rows are reported and left out; long-only violations block the commit. */
    canCommit: countOf('error') === 0,
    executions: execRows,
    cashFlows: cashRows,
    issues: result.issues,
    trades: {
      created: created.sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
      changed: changed.sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    },
  };
}

// ---------------------------------------------------------------------------

const toBatchDto = (b: ImportBatchRow) => {
  const { payload: _payload, ...rest } = b;
  return rest;
};
export type ImportBatchDto = ReturnType<typeof toBatchDto>;

function getBatchRow(db: DbOrTx, id: number): ImportBatchRow {
  const row = db.select().from(importBatches).where(eq(importBatches.id, id)).get();
  if (!row) throw notFound('Import', id);
  return row;
}

function committedWithHash(db: DbOrTx, hash: string, exceptId?: number) {
  return db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.fileHash, hash),
        eq(importBatches.status, 'COMMITTED'),
        exceptId === undefined ? undefined : ne(importBatches.id, exceptId),
      ),
    )
    .orderBy(desc(importBatches.id))
    .get();
}

export function previewImport(
  db: Db,
  input: { source: ImportSource; filename: string; data: Buffer; result: ParseResult },
) {
  const fileHash = createHash('sha256').update(input.data).digest('hex');
  const analysis = analyse(db, input.source, input.result);
  const dup = committedWithHash(db, fileHash);
  const batch = db
    .insert(importBatches)
    .values({
      source: input.source,
      filename: input.filename,
      fileHash,
      status: 'PREVIEW',
      rowsTotal: input.result.executions.length + input.result.cashFlows.length,
      rowsError: analysis.summary.errors + analysis.summary.executions.error,
      payload: JSON.stringify(input.result),
    })
    .returning()
    .get();
  return {
    batch: toBatchDto(batch),
    duplicateOf: dup
      ? { id: dup.id, filename: dup.filename, importedAt: dup.committedAt ?? dup.importedAt }
      : null,
    ...analysis,
  };
}

export function commitImport(
  db: Db,
  id: number,
  opts: { force?: boolean | undefined } = {},
): ImportBatchDto {
  return db.transaction((tx) => {
    const batch = getBatchRow(tx, id);
    if (batch.status !== 'PREVIEW')
      throw conflict('NOT_A_PREVIEW', `Import ${id} is already ${batch.status.toLowerCase()}`);
    const dup = committedWithHash(tx, batch.fileHash, id);
    if (dup && !opts.force) {
      throw conflict(
        'DUPLICATE_FILE',
        `This file was already imported (import #${dup.id}). Import it anyway to add any rows that are missing.`,
        { importId: dup.id },
      );
    }
    const result = JSON.parse(batch.payload ?? '{}') as ParseResult;
    // Re-check duplicates now: data may have changed since the preview.
    const dupExec = existingIds(
      tx,
      executions,
      result.executions.map((e) => e.externalId),
    );
    const dupCash = existingIds(
      tx,
      cashFlows,
      result.cashFlows.map((c) => c.externalId),
    );
    const newExecs = result.executions.filter((e) => !dupExec.has(e.externalId));
    const newCash = result.cashFlows.filter((c) => !dupCash.has(c.externalId));
    insertRows(tx, newExecs, newCash, batch.source, id);
    for (const symbol of new Set(newExecs.map((e) => e.symbol))) regroupSymbol(tx, symbol); // 422 rolls back
    return toBatchDto(
      tx
        .update(importBatches)
        .set({
          status: 'COMMITTED',
          committedAt: new Date().toISOString(),
          rowsInserted: newExecs.length + newCash.length,
          rowsSkippedDuplicate: dupExec.size + dupCash.size,
          payload: null,
        })
        .where(eq(importBatches.id, id))
        .returning()
        .get() ?? batch,
    );
  });
}

/** Remove everything a committed import inserted. Refused (422) if later fills depend on it. */
export function undoImport(db: Db, id: number): ImportBatchDto {
  return db.transaction((tx) => {
    const batch = getBatchRow(tx, id);
    if (batch.status !== 'COMMITTED')
      throw conflict('NOT_COMMITTED', `Import ${id} is ${batch.status.toLowerCase()}`);
    const symbols = new Set(
      tx
        .select({ symbol: executions.symbol })
        .from(executions)
        .where(eq(executions.importBatchId, id))
        .all()
        .map((r) => r.symbol),
    );
    tx.delete(executions).where(eq(executions.importBatchId, id)).run();
    tx.delete(cashFlows).where(eq(cashFlows.importBatchId, id)).run();
    for (const symbol of symbols) {
      try {
        regroupSymbol(tx, symbol);
      } catch (err) {
        if (err instanceof DomainError && err.status === 422) {
          throw new DomainError(
            422,
            'UNDO_BREAKS_POSITIONS',
            `Can't undo: later ${symbol} fills depend on fills from this import. Delete those first.`,
            err.details,
          );
        }
        throw err;
      }
    }
    return toBatchDto(
      tx
        .update(importBatches)
        .set({ status: 'UNDONE', undoneAt: new Date().toISOString() })
        .where(eq(importBatches.id, id))
        .returning()
        .get() ?? batch,
    );
  });
}

export function listImports(db: DbOrTx): ImportBatchDto[] {
  return db
    .select()
    .from(importBatches)
    .where(ne(importBatches.status, 'PREVIEW'))
    .orderBy(desc(importBatches.id))
    .all()
    .map(toBatchDto);
}

export function getImport(db: DbOrTx, id: number): ImportBatchDto {
  return toBatchDto(getBatchRow(db, id));
}
