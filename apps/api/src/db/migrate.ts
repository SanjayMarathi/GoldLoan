/**
 * Minimal forward-only migration runner.   npm run db:migrate
 * Applies every *.sql file in ./migrations (sorted by name) that has not been applied yet,
 * each inside its own transaction, and records it in schema_migrations.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { loadConfig } from '../config.ts';
import { createPool } from '../repositories/postgres.ts';
import { loadEnvFiles } from './loadEnv.ts';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(pool: Pool, log: (msg: string) => void = console.log): Promise<number> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`applied ${file}`);
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (count === 0) log('database is up to date');
  return count;
}

// Executed directly: `tsx src/db/migrate.ts`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvFiles();
  const config = loadConfig();
  if (!config.db.url) {
    console.error('DATABASE_URL is not set – nothing to migrate.');
    process.exit(1);
  }
  const pool = createPool(config.db.url);
  runMigrations(pool)
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error.message);
      await pool.end();
      process.exit(1);
    });
}
