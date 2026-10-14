import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load `.env` from the repo root (and the current directory) without any extra dependency.
 * Variables already present in the real environment are never overridden.
 */
export function loadEnvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../../../../.env'), resolve(process.cwd(), '.env')];
  for (const file of new Set(candidates)) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
