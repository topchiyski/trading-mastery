import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import { getSettings, settingsPatchSchema, updateSettings } from '../repo/settings';

export function settingsRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/settings', async () => getSettings(db));
  app.put('/api/settings', async (req) =>
    updateSettings(db, settingsPatchSchema.parse(req.body ?? {})),
  );
}
