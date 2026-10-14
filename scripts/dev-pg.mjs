// npm run dev:pg – the app (API + web) on PostgreSQL in one command.
// Uses DATABASE_URL from the environment or .env if you set one; otherwise starts the Docker database
// from docker-compose.yml and uses it. Migrations and the plan seed run automatically when the API starts.
import { COMPOSE_URL, loadDotEnv, runNpm, startDockerDb } from './pg.mjs';

loadDotEnv();
const own = process.env.DATABASE_URL;
if (!own) startDockerDb();
const url = own ?? COMPOSE_URL;
console.log(`▶ Database: ${url.replace(/\/\/([^:@/]+):[^@/]+@/, '//$1:***@')}`);
runNpm('dev', { DATABASE_URL: url, DB_DRIVER: 'postgres' });
