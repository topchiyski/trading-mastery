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
        '**/main.ts',
        '**/main.tsx',
        '**/types.ts',
      ],
      thresholds: {
        'packages/core/src/**': { lines: 95 },
      },
    },
  },
});
