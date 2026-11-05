import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { createCashFlow, deleteCashFlow, listCashFlows, updateCashFlow } from '../repo/cash-flows';
import { dateOrTimestamp, idParam, micros, plainDate } from '../validation';

const fields = {
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'INTEREST', 'FEE']),
  amount: micros,
  occurredAt: dateOrTimestamp,
  note: z.string().max(2_000).nullable(),
};
const createSchema = z.object({ ...fields, note: fields.note.optional() }).strict();
const patchSchema = z.object(fields).partial().strict();
const listQuery = z.object({ from: plainDate.optional(), to: plainDate.optional() });

export function cashFlowRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/cash-flows', async (req) => ({
    cashFlows: listCashFlows(db, listQuery.parse(req.query)),
  }));

  app.post('/api/cash-flows', async (req, reply) =>
    reply.code(201).send(createCashFlow(db, createSchema.parse(req.body))),
  );

  app.patch('/api/cash-flows/:id', async (req) =>
    updateCashFlow(db, idParam.parse(req.params).id, patchSchema.parse(req.body ?? {})),
  );

  app.delete('/api/cash-flows/:id', async (req, reply) => {
    deleteCashFlow(db, idParam.parse(req.params).id);
    return reply.code(204).send();
  });
}
