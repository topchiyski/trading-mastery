import { asc, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import { executions, type ExecutionRow } from '../db/schema';
import { notFound, type Patch } from '../errors';
import { regroupSymbol } from './regroup';

export type ExecutionSource = ExecutionRow['source'];

export interface ExecutionInput {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  commission: number;
  otherFees: number;
  executedAt: string;
  externalId?: string | null | undefined;
}

export type ExecutionPatch = Patch<ExecutionInput>;

export function toExecutionDto(row: ExecutionRow) {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    commission: row.commission,
    otherFees: row.otherFees,
    executedAt: row.executedAt,
    source: row.source,
    externalId: row.externalId,
    importBatchId: row.importBatchId,
  };
}
export type ExecutionDto = ReturnType<typeof toExecutionDto>;

export function listExecutions(
  db: Db,
  filter: { symbol?: string | undefined } = {},
): ExecutionDto[] {
  return db
    .select()
    .from(executions)
    .where(filter.symbol ? eq(executions.symbol, filter.symbol) : undefined)
    .orderBy(asc(executions.executedAt), asc(executions.id))
    .all()
    .map(toExecutionDto);
}

export function getExecutionRow(db: DbOrTx, id: number): ExecutionRow {
  const row = db.select().from(executions).where(eq(executions.id, id)).get();
  if (!row) throw notFound('Execution', id);
  return row;
}

/** Insert one execution and regroup its symbol, atomically. */
export function createExecution(
  db: Db,
  input: ExecutionInput,
  opts: { source?: ExecutionSource; importBatchId?: number | null } = {},
): { execution: ExecutionDto; tradeId: number } {
  return db.transaction((tx) => insertExecutionTx(tx, input, opts));
}

/** Insert + regroup on an existing transaction. */
export function insertExecutionTx(
  tx: DbOrTx,
  input: ExecutionInput,
  opts: { source?: ExecutionSource; importBatchId?: number | null } = {},
): { execution: ExecutionDto; tradeId: number } {
  const row = tx
    .insert(executions)
    .values({
      ...input,
      externalId: input.externalId ?? null,
      source: opts.source ?? 'MANUAL',
      importBatchId: opts.importBatchId ?? null,
    })
    .returning()
    .get();
  const tradeOf = regroupSymbol(tx, row.symbol);
  // A successful regroup always places every execution in some trade.
  return { execution: toExecutionDto(row), tradeId: tradeOf.get(row.id) ?? -1 };
}

export function updateExecution(db: Db, id: number, patch: ExecutionPatch): ExecutionDto {
  return db.transaction((tx) => {
    const before = getExecutionRow(tx, id);
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const after =
      Object.keys(changes).length > 0
        ? (tx.update(executions).set(changes).where(eq(executions.id, id)).returning().get() ??
          before)
        : before;
    regroupSymbol(tx, before.symbol);
    if (after.symbol !== before.symbol) regroupSymbol(tx, after.symbol);
    return toExecutionDto(after);
  });
}

export function deleteExecution(db: Db, id: number): void {
  db.transaction((tx) => {
    const row = getExecutionRow(tx, id);
    tx.delete(executions).where(eq(executions.id, id)).run();
    regroupSymbol(tx, row.symbol);
  });
}
