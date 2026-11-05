import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (packages/server/src -> ../../..). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Load `.env` from the repo root once, if present. Existing env vars win. */
export function loadEnv(): void {
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Paths in env vars are relative to the repo root, whatever the working directory. */
export function dbPath(): string {
  const p = process.env['DB_PATH'] ?? 'data/journal.db';
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

export function uploadsDir(): string {
  const p = process.env['UPLOADS_DIR'] ?? 'data/uploads';
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}
