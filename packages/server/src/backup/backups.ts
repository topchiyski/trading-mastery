/**
 * Backups: an online SQLite backup (`better-sqlite3` `.backup()`) of the journal plus a
 * zip of the uploads folder, named journal-YYYYMMDD-HHmm[-NN]. The 10 newest are kept.
 *
 * Restore replaces the live data without restarting: the backup is copied to a temp file,
 * migrated to the current schema, attached, and every table's rows (including the
 * AUTOINCREMENT counters) are replaced in one transaction. The current state is backed
 * up first, so a restore can itself be undone.
 */
import type Database from 'better-sqlite3';
import { unzipSync, zipSync } from 'fflate';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { toNyLocal } from '@tj/core';
import { openDatabase } from '../db/client';
import { DomainError, invalid, notFound } from '../errors';

const NAME = /^journal-\d{8}-\d{4}(-\d{2})?$/;
export const KEEP = 10;

export interface BackupInfo {
  name: string;
  createdAt: string;
  dbBytes: number;
  uploadsBytes: number;
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? filesUnder(full) : [full];
  });
}

export class Backups {
  constructor(
    private readonly opts: {
      sqlite: Database.Database;
      dir: string;
      uploadsDir: string;
      keep?: number;
      now?: () => Date;
    },
  ) {}

  private dbFile = (name: string) => join(this.opts.dir, `${name}.db`);
  private zipFile = (name: string) => join(this.opts.dir, `${name}-uploads.zip`);

  /** Validated path of an existing backup's database file. */
  path(name: string): string {
    if (!NAME.test(name)) throw invalid('Invalid backup name');
    const file = this.dbFile(name);
    if (!existsSync(file)) throw notFound('Backup', name);
    return file;
  }

  list(): BackupInfo[] {
    if (!existsSync(this.opts.dir)) return [];
    return readdirSync(this.opts.dir)
      .filter((f) => f.endsWith('.db') && NAME.test(f.slice(0, -3)))
      .map((f) => f.slice(0, -3))
      .sort()
      .reverse()
      .map((name) => {
        const db = statSync(this.dbFile(name));
        const zip = existsSync(this.zipFile(name)) ? statSync(this.zipFile(name)).size : 0;
        return { name, createdAt: db.mtime.toISOString(), dbBytes: db.size, uploadsBytes: zip };
      });
  }

  private nextName(): string {
    const { date, time } = toNyLocal((this.opts.now?.() ?? new Date()).toISOString());
    const base = `journal-${date.replace(/-/g, '')}-${time.replace(':', '')}`;
    // Always sort after every existing backup of this minute (even ones already pruned
    // would sort older), so a new backup is never the "oldest" and pruned at once.
    const taken = this.list()
      .map((b) => b.name)
      .filter((n) => n === base || n.startsWith(`${base}-`))
      .map((n) => (n === base ? 1 : Number(n.slice(base.length + 1))));
    if (taken.length === 0) return base;
    const next = Math.max(...taken) + 1;
    if (next > 99) throw new DomainError(429, 'TOO_MANY_BACKUPS', 'Too many backups this minute');
    return `${base}-${String(next).padStart(2, '0')}`;
  }

  async create(): Promise<BackupInfo> {
    mkdirSync(this.opts.dir, { recursive: true });
    const name = this.nextName();
    await this.opts.sqlite.backup(this.dbFile(name));
    const entries: Record<string, Uint8Array> = {};
    for (const file of filesUnder(this.opts.uploadsDir)) {
      entries[relative(this.opts.uploadsDir, file).split(sep).join('/')] = readFileSync(file);
    }
    // Images are already compressed: store them.
    writeFileSync(this.zipFile(name), zipSync(entries, { level: 0 }));
    this.prune();
    const info = this.list().find((b) => b.name === name);
    if (!info) throw new Error('backup vanished');
    return info;
  }

  private prune(): void {
    for (const old of this.list().slice(this.opts.keep ?? KEEP)) {
      rmSync(this.dbFile(old.name), { force: true });
      rmSync(this.zipFile(old.name), { force: true });
    }
  }

  async restore(name: string): Promise<{ restored: string; safetyBackup: string }> {
    const source = this.path(name);
    const safety = await this.create();

    // Bring the backup up to the current schema on a temp copy.
    const temp = join(this.opts.dir, `restore-${process.pid}-${Date.now()}.tmp.db`);
    copyFileSync(source, temp);
    try {
      openDatabase(temp).close();
      this.replaceTables(temp);
    } finally {
      rmSync(temp, { force: true });
      rmSync(`${temp}-wal`, { force: true });
      rmSync(`${temp}-shm`, { force: true });
    }
    this.restoreUploads(name);
    return { restored: name, safetyBackup: safety.name };
  }

  private replaceTables(file: string): void {
    const db = this.opts.sqlite;
    const tables = (schema: string) =>
      db
        .prepare(
          `SELECT name FROM ${schema}.sqlite_master WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
        )
        .all()
        .map((r) => (r as { name: string }).name);
    const columns = (schema: string, table: string) =>
      db
        .prepare(`PRAGMA ${schema}.table_info("${table}")`)
        .all()
        .map((r) => (r as { name: string }).name);

    db.pragma('foreign_keys = OFF');
    db.prepare('ATTACH DATABASE ? AS bk').run(file);
    try {
      const live = tables('main');
      const backed = new Set(tables('bk'));
      db.transaction(() => {
        for (const t of live) db.prepare(`DELETE FROM main."${t}"`).run();
        for (const t of live.filter((x) => backed.has(x))) {
          const bkCols = new Set(columns('bk', t));
          const cols = columns('main', t).filter((c) => bkCols.has(c));
          const list = cols.map((c) => `"${c}"`).join(', ');
          db.prepare(`INSERT INTO main."${t}" (${list}) SELECT ${list} FROM bk."${t}"`).run();
        }
        db.prepare('DELETE FROM main.sqlite_sequence').run();
        db.prepare('INSERT INTO main.sqlite_sequence SELECT * FROM bk.sqlite_sequence').run();
      })();
    } finally {
      db.prepare('DETACH DATABASE bk').run();
      db.pragma('foreign_keys = ON');
    }
  }

  private restoreUploads(name: string): void {
    const root = resolve(this.opts.uploadsDir);
    mkdirSync(root, { recursive: true });
    for (const entry of readdirSync(root))
      rmSync(join(root, entry), { recursive: true, force: true });
    if (!existsSync(this.zipFile(name))) return;
    const files = unzipSync(readFileSync(this.zipFile(name)));
    for (const [rel, data] of Object.entries(files)) {
      if (rel.endsWith('/')) continue;
      const target = resolve(root, rel);
      if (!target.startsWith(root + sep)) throw invalid(`Unsafe path in backup: ${rel}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
  }
}
