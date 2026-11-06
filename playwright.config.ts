import { defineConfig, devices } from '@playwright/test';

// E2E runs on its own ports and its own database so it can never touch the real journal
// or attach to a dev server that is already running.
const API_PORT = 3101;
const WEB_PORT = 5174;
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    timezoneId: 'America/New_York',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Wipe the E2E database first, then start both servers.
    command: 'node e2e/reset-data.mjs && npm run dev',
    // Wait for the API through the web proxy: both servers are up when this answers.
    url: `${WEB_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      PORT: String(API_PORT),
      API_PORT: String(API_PORT),
      WEB_PORT: String(WEB_PORT),
      DB_PATH: 'data/e2e/journal.db',
      UPLOADS_DIR: 'data/e2e/uploads',
      BACKUPS_DIR: 'data/e2e/backups',
      // Offline, deterministic prices: E2E never calls the real provider (env beats .env).
      MARKET_DATA_PROVIDER: 'synthetic',
    },
  },
});
