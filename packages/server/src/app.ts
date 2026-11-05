import Fastify, { type FastifyInstance } from 'fastify';
import { healthStatus } from '@tj/core';

export type AppOptions = {
  logger?: boolean;
};

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get('/api/health', async () => healthStatus());

  return app;
}
