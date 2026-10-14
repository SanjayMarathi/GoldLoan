// npm run db:check:hf – test the hosted PostgreSQL in .env.hf (Neon / Supabase) from your own computer,
// BEFORE deploying: connects over SSL, prints the server version and whether the app's tables exist yet.
// The app creates its tables itself on first start, so "no tables yet" is fine.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { ROOT } from './pg.mjs';

const file = resolve(ROOT, process.argv[2] ?? '.env.hf');
if (!existsSync(file)) {
  console.error(`✖ ${file} not found. Copy .env.hf.example to .env.hf and paste your DATABASE_URL into it.`);
  process.exit(1);
}
process.loadEnvFile(file);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error(`✖ DATABASE_URL is empty in ${file}.`);
  process.exit(1);
}

const safe = url.replace(/\/\/([^:@/]+):[^@/]+@/, '//$1:***@');
console.log(`▶ Connecting to ${safe}`);
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
try {
  await client.connect();
  const { rows } = await client.query('SELECT version() AS v, current_database() AS db');
  console.log(`✓ Connected: ${rows[0].db} – ${rows[0].v.split(',')[0]}`);
  const t = await client.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('loan_schemes', 'leads', 'lead_audit')",
  );
  console.log(t.rows[0].n === 3 ? '✓ The app’s tables already exist.' : '• No app tables yet – the app creates them on its first start.');
} catch (error) {
  console.error(`✖ Could not connect: ${error.message}`);
  console.error('  Check the connection string (copy it again from the provider) and that it ends with ?sslmode=require.');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
