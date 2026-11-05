// Deletes the E2E-only data directory before the E2E servers start.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../data/e2e/', import.meta.url));
rmSync(dir, { recursive: true, force: true });
console.log(`e2e: reset ${dir}`);
