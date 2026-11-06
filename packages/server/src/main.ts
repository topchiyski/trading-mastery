import { buildApp } from './app';
import { dbPath, loadEnv, uploadsDir } from './config';
import { openDatabase } from './db/client';
import { marketDataFromEnv } from './market/from-env';

loadEnv();
const port = Number(process.env['PORT'] ?? 3001);
const database = openDatabase(dbPath());
const market = marketDataFromEnv(database.db);
const app = buildApp({
  db: database.db,
  uploadsDir: uploadsDir(),
  market,
  backgroundSyncMs: 15 * 60_000,
  logger: true,
});
app.log.info(`market data: ${market.provider?.name ?? 'not configured'}`);

const shutdown = () => {
  void app.close().finally(() => {
    database.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Local-only app: bind to loopback, never 0.0.0.0.
app.listen({ host: '127.0.0.1', port }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
