import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { addStop, deleteStop, listStops } from '../repo/stops';
import {
  addFill,
  createTrade,
  deleteOrphanedTrade,
  getTradeDetail,
  getTradeRow,
  listTrades,
  setTradeTags,
  updateJournal,
} from '../repo/trades';
import {
  idParam,
  nonNegativeMicros,
  optionalText,
  plainDate,
  positiveMicros,
  ticker,
  timestamp,
} from '../validation';

const fill = z
  .object({
    quantity: z.number().int().positive().max(1_000_000_000),
    price: positiveMicros,
    commission: nonNegativeMicros.default(0),
    otherFees: nonNegativeMicros.default(0),
    executedAt: timestamp,
  })
  .strict();

const journalFields = {
  initialStop: positiveMicros.nullable(),
  plannedRiskOverride: positiveMicros.nullable(),
  target: positiveMicros.nullable(),
  setupTagId: z.number().int().positive().nullable(),
  thesis: optionalText,
  review: optionalText,
  emotion: z.string().max(200).nullable(),
  executionRating: z.number().int().min(1).max(5).nullable(),
  followedPlan: z.boolean().nullable(),
};
const journalPatch = z.object(journalFields).partial().strict();

const createSchema = z
  .object({
    symbol: ticker,
    fill,
    initialStop: journalFields.initialStop.optional(),
    plannedRiskOverride: journalFields.plannedRiskOverride.optional(),
    target: journalFields.target.optional(),
    setupTagId: journalFields.setupTagId.optional(),
    thesis: journalFields.thesis.optional(),
  })
  .strict();

const fillSchema = fill.extend({ side: z.enum(['BUY', 'SELL']) });

const listQuery = z.object({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  symbol: z.string().toUpperCase().optional(),
  setupTagId: z.coerce.number().int().positive().optional(),
  tagId: z.coerce.number().int().positive().optional(),
  outcome: z.enum(['WIN', 'LOSS', 'BREAKEVEN']).optional(),
  from: plainDate.optional(),
  to: plainDate.optional(),
  orphaned: z.enum(['exclude', 'include', 'only']).optional(),
});

const stopSchema = z
  .object({ stopPrice: positiveMicros, changedAt: timestamp.optional() })
  .strict();
const tagsSchema = z.object({ tagIds: z.array(z.number().int().positive()).max(100) }).strict();

export function tradeRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/trades', async (req) => listTrades(db, listQuery.parse(req.query)));

  app.post('/api/trades', async (req, reply) =>
    reply.code(201).send(createTrade(db, createSchema.parse(req.body))),
  );

  app.get('/api/trades/:id', async (req) => getTradeDetail(db, idParam.parse(req.params).id));

  app.patch('/api/trades/:id', async (req) =>
    updateJournal(db, idParam.parse(req.params).id, journalPatch.parse(req.body ?? {})),
  );

  app.delete('/api/trades/:id', async (req, reply) => {
    deleteOrphanedTrade(db, idParam.parse(req.params).id);
    return reply.code(204).send();
  });

  app.post('/api/trades/:id/fills', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return reply.code(201).send(addFill(db, id, fillSchema.parse(req.body)));
  });

  app.put('/api/trades/:id/tags', async (req) =>
    setTradeTags(db, idParam.parse(req.params).id, tagsSchema.parse(req.body).tagIds),
  );

  app.get('/api/trades/:id/stops', async (req) => {
    const { id } = idParam.parse(req.params);
    getTradeRow(db, id);
    return { stops: listStops(db, id) };
  });

  app.post('/api/trades/:id/stops', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getTradeRow(db, id);
    return reply.code(201).send(addStop(db, id, stopSchema.parse(req.body)));
  });

  app.delete('/api/stops/:id', async (req, reply) => {
    deleteStop(db, idParam.parse(req.params).id);
    return reply.code(204).send();
  });
}
