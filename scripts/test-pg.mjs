// npm run test:pg – every test, including the PostgreSQL ones (advisory locks, constraints, migrations).
// The PostgreSQL tests EMPTY their tables, so they use a separate database (goldloan_test), created here if missing.
import pg from 'pg';
import { COMPOSE_URL, loadDotEnv, runNpm, startDockerDb } from './pg.mjs';

loadDotEnv();
let testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  startDockerDb();
  const admin = new pg.Client({ connectionString: COMPOSE_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'goldloan_test'");
  if (rowCount === 0) {
    await admin.query('CREATE DATABASE goldloan_test');
    console.log('▶ Created database goldloan_test');
  }
  await admin.end();
  testUrl = COMPOSE_URL.replace(/\/goldloan$/, '/goldloan_test');
}
console.log('▶ Running all tests, PostgreSQL included');
runNpm('test', { TEST_DATABASE_URL: testUrl });
