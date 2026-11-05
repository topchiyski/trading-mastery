import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Ports are overridable so E2E can run beside a normal dev session.
const webPort = Number(process.env['WEB_PORT'] ?? 5173);
const apiPort = Number(process.env['API_PORT'] ?? 3001);

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
