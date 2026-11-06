import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import type { MarketData } from '../market/market-data';
import type { MarketSync } from '../market/sync';
import { getPositions, getTradeChart } from '../repo/market';
import { idParam } from '../validation';

const syncBody = z.object({ wait: z.boolean().optional() }).strict();

export function marketRoutes(app: FastifyInstance, db: Db, md: MarketData, sync: MarketSync): void {
  app.get('/api/trades/:id/chart', async (req) =>
    getTradeChart(db, md, idParam.parse(req.params).id),
  );

  app.get('/api/positions', async () => getPositions(db, md));

  app.get('/api/market-data/status', async () => sync.status());

  /** Start a backfill run (or wait for it with `{ wait: true }`) and return the status. */
  app.post('/api/market-data/sync', async (req) => {
    const { wait } = syncBody.parse(req.body ?? {});
    const run = sync.runOnce();
    if (wait) await run;
    else void run;
    return sync.status();
  });
}
