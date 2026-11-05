import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Db } from '../db/client';
import { invalid, notFound } from '../errors';
import {
  addScreenshot,
  deleteScreenshot,
  getScreenshot,
  mimeForPath,
  updateCaption,
  uploadPath,
} from '../repo/screenshots';
import { getTradeRow } from '../repo/trades';
import { idParam } from '../validation';

const captionSchema = z.object({ caption: z.string().max(500).nullable() }).strict();

export function screenshotRoutes(app: FastifyInstance, db: Db, uploadsDir: string): void {
  app.post('/api/trades/:id/screenshots', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getTradeRow(db, id);
    const file = await req.file();
    if (!file) throw invalid('Attach an image in the "file" field');
    const data = await file.toBuffer(); // throws 413 past the size limit
    const field = file.fields['caption'];
    const raw = field && !Array.isArray(field) && field.type === 'field' ? String(field.value) : '';
    const caption = raw.trim().slice(0, 500) || null;
    return reply.code(201).send(addScreenshot(db, uploadsDir, id, data, caption));
  });

  app.get('/api/screenshots/:id/file', async (req, reply) => {
    const shot = getScreenshot(db, idParam.parse(req.params).id);
    let data: Buffer;
    try {
      data = await readFile(uploadPath(uploadsDir, shot));
    } catch {
      throw notFound('Screenshot file', shot.id);
    }
    return reply
      .header('content-type', mimeForPath(shot.filePath))
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(data);
  });

  app.patch('/api/screenshots/:id', async (req) =>
    updateCaption(db, idParam.parse(req.params).id, captionSchema.parse(req.body).caption),
  );

  app.delete('/api/screenshots/:id', async (req, reply) => {
    deleteScreenshot(db, uploadsDir, idParam.parse(req.params).id);
    return reply.code(204).send();
  });
}
