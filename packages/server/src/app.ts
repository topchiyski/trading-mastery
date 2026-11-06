import { healthStatus } from '@tj/core';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db/client';
import { DomainError, isUniqueViolation } from './errors';
import { cashFlowRoutes } from './routes/cash-flows';
import { executionRoutes } from './routes/executions';
import { importRoutes } from './routes/imports';
import { screenshotRoutes } from './routes/screenshots';
import { settingsRoutes } from './routes/settings';
import { tagRoutes } from './routes/tags';
import { tradeRoutes } from './routes/trades';

export interface AppOptions {
  db: Db;
  /** Where screenshots are stored. */
  uploadsDir: string;
  /** Max upload size in bytes (default 10 MB). */
  maxUploadBytes?: number;
  logger?: boolean;
}

/** Error responses are always `{ error: { code, message, details? } }`. */
function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      const first = issues[0];
      const message = first ? `${first.path || 'body'}: ${first.message}` : 'Invalid input';
      return reply.code(400).send(errorBody('VALIDATION_ERROR', message, { issues }));
    }
    if (err instanceof DomainError) {
      return reply.code(err.status).send(errorBody(err.code, err.message, err.details));
    }
    if (isUniqueViolation(err)) {
      return reply
        .code(409)
        .send(errorBody('DUPLICATE', 'A record with the same unique value already exists'));
    }
    const status = 'statusCode' in err && err.statusCode ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    return reply
      .code(status)
      .send(
        errorBody(
          status >= 500 ? 'INTERNAL' : 'BAD_REQUEST',
          status >= 500 ? 'Internal error' : err.message,
        ),
      );
  });

  void app.register(multipart, {
    limits: { fileSize: opts.maxUploadBytes ?? 10 * 1024 * 1024, files: 1, fields: 5 },
  });

  app.get('/api/health', async () => healthStatus());

  executionRoutes(app, opts.db);
  tradeRoutes(app, opts.db, opts.uploadsDir);
  screenshotRoutes(app, opts.db, opts.uploadsDir);
  tagRoutes(app, opts.db);
  cashFlowRoutes(app, opts.db);
  settingsRoutes(app, opts.db);
  importRoutes(app, opts.db);

  return app;
}
