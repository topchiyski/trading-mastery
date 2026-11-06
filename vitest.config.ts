import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/__fixtures__/**',
        '**/test-setup.ts',
        '**/main.ts',
        '**/main.tsx',
        '**/types.ts',
      ],
      // `npm run test:coverage` fails if a package drops below these.
      thresholds: {
        'packages/core/src/**': { lines: 98, branches: 92 },
        'packages/server/src/**': { lines: 95, branches: 80 },
        'packages/web/src/**': { lines: 95, branches: 82 },
      },
    },
  },
});
