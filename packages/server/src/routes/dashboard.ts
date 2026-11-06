import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import type { MarketData } from '../market/market-data';
import { getDashboard } from '../repo/dashboard';
import { plainDate } from '../validation';

const query = z.object({
  from: plainDate.optional(),
  to: plainDate.optional(),
  setupTagId: z.coerce.number().int().positive().optional(),
  tagId: z.coerce.number().int().positive().optional(),
  symbol: z.string().trim().toUpperCase().min(1).optional(),
});

export function dashboardRoutes(app: FastifyInstance, db: Db, md?: MarketData): void {
  app.get('/api/dashboard', async (req) => getDashboard(db, query.parse(req.query), md));
}
