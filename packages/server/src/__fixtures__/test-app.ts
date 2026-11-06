// Test-only: an app backed by a fresh in-memory database and a temp uploads dir, plus HTTP helpers.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { buildApp } from '../app';
import { openDatabase, type OpenDatabase } from '../db/client';
import { MarketData } from '../market/market-data';

export interface TestApp {
  app: FastifyInstance;
  database: OpenDatabase;
  uploadsDir: string;
  get: <T = any>(url: string) => Promise<{ status: number; body: T }>;
  post: <T = any>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  patch: <T = any>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  put: <T = any>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  del: <T = any>(url: string) => Promise<{ status: number; body: T }>;
}

const open: TestApp[] = [];

afterEach(async () => {
  for (const t of open.splice(0)) {
    await t.app.close();
    t.database.close();
    rmSync(t.uploadsDir, { recursive: true, force: true });
  }
});

export function createTestApp(
  opts: {
    maxUploadBytes?: number;
    /** Market data (default: no provider configured, cached data only). */
    market?: (db: OpenDatabase['db']) => MarketData;
  } = {},
): TestApp {
  const database = openDatabase(':memory:');
  const uploadsDir = mkdtempSync(join(tmpdir(), 'tj-uploads-'));
  const { market, ...rest } = opts;
  const app = buildApp({
    db: database.db,
    uploadsDir,
    market: market ? market(database.db) : new MarketData({ db: database.db, provider: null }),
    ...rest,
  });
  const call =
    (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE') =>
    async (url: string, payload?: unknown) => {
      const res = await app.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return { status: res.statusCode, body: res.body ? res.json() : undefined };
    };
  const t: TestApp = {
    app,
    database,
    uploadsDir,
    get: call('GET'),
    post: call('POST'),
    patch: call('PATCH'),
    put: call('PUT'),
    del: call('DELETE'),
  };
  open.push(t);
  return t;
}

/** ISO timestamp on a March 2026 day at 15:00 UTC (10:00/11:00 New York). */
export const at = (day: number, minute = 0) =>
  `2026-03-${String(day).padStart(2, '0')}T15:${String(minute).padStart(2, '0')}:00.000Z`;

/** A multipart/form-data body with text fields and an optional file. */
export function multipart(
  fields: Record<string, string>,
  file?: { name: string; filename: string; contentType: string; data: Buffer },
) {
  const boundary = `----tj${Math.random().toString(16).slice(2)}`;
  const CRLF = '\r\n';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`,
      ),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"${CRLF}` +
          `Content-Type: ${file.contentType}${CRLF}${CRLF}`,
      ),
      file.data,
      Buffer.from(CRLF),
    );
  }
  parts.push(Buffer.from(`--${boundary}--${CRLF}`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** Smallest valid PNG (1×1 transparent). */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
