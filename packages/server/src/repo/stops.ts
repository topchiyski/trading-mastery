import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { stopChanges, type StopChangeRow } from '../db/schema';
import { notFound } from '../errors';

export type StopDto = StopChangeRow;

export function listStops(db: DbOrTx, tradeId: number): StopDto[] {
  return db
    .select()
    .from(stopChanges)
    .where(eq(stopChanges.tradeId, tradeId))
    .orderBy(asc(stopChanges.changedAt), asc(stopChanges.id))
    .all();
}

export function addStop(
  db: DbOrTx,
  tradeId: number,
  input: { stopPrice: number; changedAt?: string | undefined },
): StopDto {
  return db
    .insert(stopChanges)
    .values({
      tradeId,
      stopPrice: input.stopPrice,
      changedAt: input.changedAt ?? new Date().toISOString(),
    })
    .returning()
    .get();
}

export function deleteStop(db: DbOrTx, id: number): void {
  const row = db.delete(stopChanges).where(eq(stopChanges.id, id)).returning().get();
  if (!row) throw notFound('Stop change', id);
}
