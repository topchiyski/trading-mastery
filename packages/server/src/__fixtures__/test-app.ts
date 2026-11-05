// Test-only: an app backed by a fresh in-memory database, plus small HTTP helpers.
import type { FastifyInstance } from 'fastify';
import { afterEach } from 'vitest';
import { buildApp } from '../app';
import { openDatabase, type OpenDatabase } from '../db/client';

export interface TestApp {
  app: FastifyInstance;
  database: OpenDatabase;
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
  }
});

export function createTestApp(): TestApp {
  const database = openDatabase(':memory:');
  const app = buildApp({ db: database.db });
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
