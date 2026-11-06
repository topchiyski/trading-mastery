import { isAbsolute, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT, backupsDir, dbPath, uploadsDir } from './config';

const saved = { ...process.env };
afterEach(() => {
  for (const k of ['DB_PATH', 'UPLOADS_DIR', 'BACKUPS_DIR']) {
    if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = saved[k];
  }
});

describe('config paths', () => {
  it.each([
    ['DB_PATH', dbPath, 'data/journal.db'],
    ['UPLOADS_DIR', uploadsDir, 'data/uploads'],
    ['BACKUPS_DIR', backupsDir, 'data/backups'],
  ] as const)(
    '%s defaults under the repo root, accepts relative and absolute paths',
    (key, fn, fallback) => {
      Reflect.deleteProperty(process.env, key);
      expect(fn()).toBe(resolve(REPO_ROOT, fallback));
      process.env[key] = 'custom/place';
      expect(fn()).toBe(resolve(REPO_ROOT, 'custom/place'));
      const abs = resolve(join(REPO_ROOT, '..', 'elsewhere'));
      process.env[key] = abs;
      expect(fn()).toBe(abs);
      expect(isAbsolute(fn())).toBe(true);
    },
  );

  it('points REPO_ROOT at the repository', () => {
    expect(resolve(REPO_ROOT, 'package.json')).toMatch(/trading-mastery[\\/]package\.json$/);
  });
});
