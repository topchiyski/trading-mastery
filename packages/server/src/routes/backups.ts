import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Backups } from '../backup/backups';
import { invalid } from '../errors';

const nameParam = z.object({ name: z.string().max(64) });
const restoreBody = z.object({ confirm: z.literal(true).optional() }).strict();

export function backupRoutes(app: FastifyInstance, backups: Backups): void {
  app.get('/api/backups', async () => ({ backups: backups.list() }));

  app.post('/api/backups', async (_req, reply) => reply.code(201).send(await backups.create()));

  app.post('/api/backups/:name/restore', async (req) => {
    const { name } = nameParam.parse(req.params);
    if (!restoreBody.parse(req.body ?? {}).confirm) {
      throw invalid('Restoring replaces all current data; send { "confirm": true }');
    }
    return backups.restore(name);
  });

  app.get('/api/backups/:name/download', async (req, reply) => {
    const { name } = nameParam.parse(req.params);
    const data = await readFile(backups.path(name));
    return reply
      .header('content-type', 'application/vnd.sqlite3')
      .header('content-disposition', `attachment; filename="${name}.db"`)
      .send(data);
  });
}
