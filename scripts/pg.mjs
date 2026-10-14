// Shared helpers for `npm run dev:pg` and `npm run test:pg`: find the PostgreSQL URL, start the Docker
// database when we are using the default one, and run an npm script against it. Plain Node, no dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const COMPOSE_URL = 'postgresql://gold:gold@localhost:5432/goldloan';

/** Variables from the repo's .env (if any) without overriding the real environment – same rule as the API. */
export function loadDotEnv() {
  const file = resolve(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

/** `docker compose up -d --wait db` – returns only once PostgreSQL passes its health check. */
export function startDockerDb() {
  console.log('▶ Starting PostgreSQL in Docker (docker compose up -d --wait db)…');
  const r = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'db'], { cwd: ROOT, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error(
      '\n✖ Could not start PostgreSQL with Docker.\n' +
        '  • Make sure Docker Desktop is running, then try again, or\n' +
        '  • point DATABASE_URL (in .env) at your own PostgreSQL 14+, or\n' +
        '  • use `npm run dev`, which runs without a database (in-memory).\n',
    );
    process.exit(1);
  }
}

/** Run `npm run <script>` with extra environment variables and exit with its exit code. */
export function runNpm(script, env) {
  const child = spawn(`npm run ${script}`, { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
}
