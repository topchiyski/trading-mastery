import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './client';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A copy of the migrations folder containing only the first `n` migrations. */
function migrationsUpTo(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'tj-mig-'));
  dirs.push(dir);
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, n);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migrations', () => {
  it('0001 rescales whole-share quantities to micro-shares', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsUpTo(1) });
    sqlite
      .prepare(
        `INSERT INTO executions (symbol, side, quantity, price, executed_at, source)
         VALUES ('AAPL', 'BUY', 100, 50000000, '2026-03-02T15:00:00.000Z', 'MANUAL')`,
      )
      .run();

    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    expect(sqlite.prepare('SELECT quantity FROM executions').get()).toEqual({
      quantity: 100_000_000,
    });
    // Re-running is a no-op (already applied).
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    expect(sqlite.prepare('SELECT quantity FROM executions').get()).toEqual({
      quantity: 100_000_000,
    });
    sqlite.close();
  });
});
