import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  createExecution,
  deleteExecution,
  listExecutions,
  updateExecution,
} from '../repo/executions';
import { idParam, nonNegativeMicros, positiveMicros, ticker, timestamp } from '../validation';

const fields = {
  symbol: ticker,
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().int().positive().max(1_000_000_000),
  price: positiveMicros,
  commission: nonNegativeMicros,
  otherFees: nonNegativeMicros,
  executedAt: timestamp,
  externalId: z.string().trim().min(1).max(200).nullable(),
};

const createSchema = z
  .object({
    ...fields,
    commission: fields.commission.default(0),
    otherFees: fields.otherFees.default(0),
    externalId: fields.externalId.optional(),
  })
  .strict();
const patchSchema = z.object(fields).partial().strict();
const listQuery = z.object({ symbol: z.string().toUpperCase().optional() });

export function executionRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/executions', async (req) => ({
    executions: listExecutions(db, listQuery.parse(req.query)),
  }));

  app.post('/api/executions', async (req, reply) => {
    const result = createExecution(db, createSchema.parse(req.body));
    return reply.code(201).send(result);
  });

  app.patch('/api/executions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return { execution: updateExecution(db, id, patchSchema.parse(req.body ?? {})) };
  });

  app.delete('/api/executions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    deleteExecution(db, id);
    return reply.code(204).send();
  });
}
