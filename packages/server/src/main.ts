import { buildApp } from './app';

const port = Number(process.env['PORT'] ?? 3001);
const app = buildApp({ logger: true });

// Local-only app: bind to loopback, never 0.0.0.0.
app.listen({ host: '127.0.0.1', port }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
