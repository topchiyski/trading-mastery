import { asc, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import { tags, trades, tradeTags, type TagRow } from '../db/schema';
import { invalid, notFound } from '../errors';

export type TagKind = TagRow['kind'];
export type TagDto = TagRow;

export function listTags(db: DbOrTx, kind?: TagKind): TagDto[] {
  return db
    .select()
    .from(tags)
    .where(kind ? eq(tags.kind, kind) : undefined)
    .orderBy(asc(tags.name))
    .all();
}

export function getTag(db: DbOrTx, id: number): TagDto {
  const row = db.select().from(tags).where(eq(tags.id, id)).get();
  if (!row) throw notFound('Tag', id);
  return row;
}

export function createTag(
  db: DbOrTx,
  input: { name: string; kind: TagKind; color?: string | undefined },
): TagDto {
  return db
    .insert(tags)
    .values({ name: input.name, kind: input.kind, ...(input.color ? { color: input.color } : {}) })
    .returning()
    .get();
}

export function updateTag(
  db: DbOrTx,
  id: number,
  patch: { name?: string | undefined; color?: string | undefined },
): TagDto {
  const current = getTag(db, id);
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(changes).length === 0) return current;
  return db.update(tags).set(changes).where(eq(tags.id, id)).returning().get() ?? current;
}

/**
 * Delete a tag. With `reassignTo`, every use moves to that tag first (same kind
 * required) — this is also how tags are merged.
 */
export function deleteTag(db: Db, id: number, reassignTo?: number): void {
  db.transaction((tx) => {
    const tag = getTag(tx, id);
    if (reassignTo !== undefined) {
      if (reassignTo === id) throw invalid('Cannot merge a tag into itself');
      const target = getTag(tx, reassignTo);
      if (target.kind !== tag.kind) {
        throw invalid(`Cannot move a ${tag.kind} tag into a ${target.kind} tag`);
      }
      tx.update(trades).set({ setupTagId: target.id }).where(eq(trades.setupTagId, id)).run();
      const uses = tx.select().from(tradeTags).where(eq(tradeTags.tagId, id)).all();
      if (uses.length > 0) {
        tx.insert(tradeTags)
          .values(uses.map((u) => ({ tradeId: u.tradeId, tagId: target.id })))
          .onConflictDoNothing()
          .run();
      }
    }
    // FKs: trades.setup_tag_id is SET NULL, trade_tags rows CASCADE.
    tx.delete(tags).where(eq(tags.id, id)).run();
  });
}
