import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { screenshots } from '../db/schema';
import { DomainError, notFound } from '../errors';

const SIGNATURES: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** Detect the image type from its first bytes; the client's content-type is not trusted. */
export function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  const hit = SIGNATURES.find((s) => s.test(buf));
  return hit ? { ext: hit.ext, mime: hit.mime } : null;
}

export function mimeForPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1);
  return SIGNATURES.find((s) => s.ext === ext)?.mime ?? 'application/octet-stream';
}

/** Absolute path of a stored file, refusing anything that escapes the uploads dir. */
export function resolveUpload(uploadsDir: string, filePath: string): string {
  const root = resolve(uploadsDir);
  const full = resolve(root, filePath);
  if (!full.startsWith(root + sep)) throw new DomainError(400, 'BAD_PATH', 'Invalid file path');
  return full;
}

const toDto = (row: typeof screenshots.$inferSelect) => ({
  ...row,
  url: `/api/screenshots/${row.id}/file`,
});
export type ScreenshotDto = ReturnType<typeof toDto>;

export function listScreenshots(db: DbOrTx, tradeId: number): ScreenshotDto[] {
  return db.select().from(screenshots).where(eq(screenshots.tradeId, tradeId)).all().map(toDto);
}

export function getScreenshot(db: DbOrTx, id: number): ScreenshotDto {
  const row = db.select().from(screenshots).where(eq(screenshots.id, id)).get();
  if (!row) throw notFound('Screenshot', id);
  return toDto(row);
}

export function addScreenshot(
  db: DbOrTx,
  uploadsDir: string,
  tradeId: number,
  data: Buffer,
  caption: string | null,
): ScreenshotDto {
  const kind = sniffImage(data);
  if (!kind) {
    throw new DomainError(
      400,
      'UNSUPPORTED_FILE',
      'Only PNG, JPEG, WebP and GIF images can be uploaded',
    );
  }
  const filePath = `${tradeId}/${randomUUID()}.${kind.ext}`;
  const full = resolveUpload(uploadsDir, filePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  try {
    return toDto(db.insert(screenshots).values({ tradeId, filePath, caption }).returning().get());
  } catch (err) {
    rmSync(full, { force: true });
    throw err;
  }
}

export function updateCaption(db: DbOrTx, id: number, caption: string | null): ScreenshotDto {
  const current = getScreenshot(db, id);
  const row = db
    .update(screenshots)
    .set({ caption })
    .where(eq(screenshots.id, id))
    .returning()
    .get();
  return row ? toDto(row) : current;
}

export function removeFiles(uploadsDir: string, rows: readonly { filePath: string }[]): void {
  for (const r of rows) rmSync(resolveUpload(uploadsDir, r.filePath), { force: true });
}

export function deleteScreenshot(db: DbOrTx, uploadsDir: string, id: number): void {
  const row = getScreenshot(db, id);
  db.delete(screenshots).where(eq(screenshots.id, id)).run();
  removeFiles(uploadsDir, [row]);
}

export const uploadPath = (uploadsDir: string, row: { filePath: string }) =>
  resolveUpload(uploadsDir, row.filePath);
