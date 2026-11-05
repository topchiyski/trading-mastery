import { nyDateOf, type CashFlowType } from '@tj/core';
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { cashFlows, type CashFlowRow } from '../db/schema';
import { invalid, notFound, type Patch } from '../errors';

export type CashFlowDto = CashFlowRow;

export interface CashFlowInput {
  type: CashFlowType;
  amount: number;
  occurredAt: string;
  note?: string | null | undefined;
  externalId?: string | null | undefined;
}

/** Deposits are money in (> 0), withdrawals money out (< 0); other types any non-zero amount. */
export function checkCashFlowSign(type: CashFlowType, amount: number): void {
  if (amount === 0) throw invalid('Amount must not be zero');
  if (type === 'DEPOSIT' && amount < 0) throw invalid('A deposit must be positive');
  if (type === 'WITHDRAWAL' && amount > 0) throw invalid('A withdrawal must be negative');
}

export function listCashFlows(
  db: DbOrTx,
  range: { from?: string | undefined; to?: string | undefined } = {},
): CashFlowDto[] {
  return db
    .select()
    .from(cashFlows)
    .orderBy(asc(cashFlows.occurredAt), asc(cashFlows.id))
    .all()
    .filter((c) => {
      const d = nyDateOf(c.occurredAt);
      return (!range.from || d >= range.from) && (!range.to || d <= range.to);
    });
}

function getCashFlow(db: DbOrTx, id: number): CashFlowDto {
  const row = db.select().from(cashFlows).where(eq(cashFlows.id, id)).get();
  if (!row) throw notFound('Cash flow', id);
  return row;
}

export function createCashFlow(
  db: DbOrTx,
  input: CashFlowInput,
  importBatchId: number | null = null,
): CashFlowDto {
  checkCashFlowSign(input.type, input.amount);
  return db
    .insert(cashFlows)
    .values({
      type: input.type,
      amount: input.amount,
      occurredAt: input.occurredAt,
      note: input.note ?? null,
      externalId: input.externalId ?? null,
      importBatchId,
    })
    .returning()
    .get();
}

export function updateCashFlow(db: DbOrTx, id: number, patch: Patch<CashFlowInput>): CashFlowDto {
  const current = getCashFlow(db, id);
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const merged = { ...current, ...changes } as CashFlowDto;
  checkCashFlowSign(merged.type, merged.amount);
  if (Object.keys(changes).length === 0) return current;
  return db.update(cashFlows).set(changes).where(eq(cashFlows.id, id)).returning().get() ?? current;
}

export function deleteCashFlow(db: DbOrTx, id: number): void {
  const row = db.delete(cashFlows).where(eq(cashFlows.id, id)).returning().get();
  if (!row) throw notFound('Cash flow', id);
}
