import { buildApp } from './app';
import { dbPath, loadEnv } from './config';
import { openDatabase } from './db/client';

loadEnv();
const port = Number(process.env['PORT'] ?? 3001);
const database = openDatabase(dbPath());
const app = buildApp({ db: database.db, logger: true });

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
