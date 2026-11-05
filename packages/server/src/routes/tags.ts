import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { createTag, deleteTag, getTag, listTags, updateTag } from '../repo/tags';
import { idParam } from '../validation';

const kind = z.enum(['SETUP', 'MISTAKE', 'CUSTOM']);
const name = z.string().trim().min(1).max(60);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex colour like #22c55e');

const createSchema = z.object({ name, kind, color: color.optional() }).strict();
const patchSchema = z.object({ name, color }).partial().strict();
const deleteQuery = z.object({ reassignTo: z.coerce.number().int().positive().optional() });
const mergeSchema = z.object({ intoId: z.number().int().positive() }).strict();

export function tagRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/tags', async (req) => ({
    tags: listTags(db, z.object({ kind: kind.optional() }).parse(req.query).kind),
  }));

  app.post('/api/tags', async (req, reply) =>
    reply.code(201).send(createTag(db, createSchema.parse(req.body))),
  );

  app.patch('/api/tags/:id', async (req) =>
    updateTag(db, idParam.parse(req.params).id, patchSchema.parse(req.body ?? {})),
  );

  app.delete('/api/tags/:id', async (req, reply) => {
    deleteTag(db, idParam.parse(req.params).id, deleteQuery.parse(req.query).reassignTo);
    return reply.code(204).send();
  });

  app.post('/api/tags/:id/merge', async (req) => {
    const { intoId } = mergeSchema.parse(req.body);
    deleteTag(db, idParam.parse(req.params).id, intoId);
    return getTag(db, intoId);
  });
}
