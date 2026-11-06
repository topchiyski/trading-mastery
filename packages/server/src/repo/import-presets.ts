import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { importPresets, type ImportPresetRow } from '../db/schema';
import { invalid, notFound } from '../errors';
import { csvMappingSchema, type CsvMapping } from '../import/generic-csv';

const toDto = (row: ImportPresetRow) => {
  const parsed = csvMappingSchema.safeParse(JSON.parse(row.mapping));
  return {
    id: row.id,
    name: row.name,
    mapping: parsed.success ? parsed.data : null,
    createdAt: row.createdAt,
  };
};
export type ImportPresetDto = ReturnType<typeof toDto>;

export function listPresets(db: DbOrTx): ImportPresetDto[] {
  return db.select().from(importPresets).orderBy(asc(importPresets.name)).all().map(toDto);
}

export function getPresetMapping(db: DbOrTx, id: number): CsvMapping {
  const row = db.select().from(importPresets).where(eq(importPresets.id, id)).get();
  if (!row) throw notFound('Import preset', id);
  const mapping = toDto(row).mapping;
  if (!mapping) throw invalid(`Preset "${row.name}" is no longer valid; edit it first`);
  return mapping;
}

export function createPreset(
  db: DbOrTx,
  input: { name: string; mapping: CsvMapping },
): ImportPresetDto {
  return toDto(
    db
      .insert(importPresets)
      .values({ name: input.name, mapping: JSON.stringify(input.mapping) })
      .returning()
      .get(),
  );
}

export function updatePreset(
  db: DbOrTx,
  id: number,
  input: { name: string; mapping: CsvMapping },
): ImportPresetDto {
  const row = db
    .update(importPresets)
    .set({ name: input.name, mapping: JSON.stringify(input.mapping) })
    .where(eq(importPresets.id, id))
    .returning()
    .get();
  if (!row) throw notFound('Import preset', id);
  return toDto(row);
}

export function deletePreset(db: DbOrTx, id: number): void {
  if (!db.delete(importPresets).where(eq(importPresets.id, id)).returning().get()) {
    throw notFound('Import preset', id);
  }
}
