import type { AppConfig } from '../config.ts';
import type { Logger } from '../lib/logger.ts';
import type { Repositories } from './interfaces.ts';
import { MemoryRepositories } from './memory.ts';

/**
 * Chooses the storage backend. PostgreSQL is loaded lazily, so memory mode (tests, evals, a quick demo)
 * never even imports the `pg` driver. With Postgres, migrations and the (idempotent) seed run on startup.
 */
export async function createRepositories(config: AppConfig, logger: Logger): Promise<Repositories> {
  if (config.db.driver !== 'postgres') {
    logger.warn('DB_DRIVER=memory – data is lost on restart. Set DATABASE_URL for PostgreSQL.');
    return new MemoryRepositories();
  }
  const [{ PostgresRepositories, createPool }, { runMigrations }, { seedSchemes }] = await Promise.all([
    import('./postgres.ts'),
    import('../db/migrate.ts'),
    import('../db/seed.ts'),
  ]);
  const pool = createPool(config.db.url!);
  try {
    await runMigrations(pool, (m) => logger.info(m));
    await seedSchemes(pool, (m) => logger.debug(m));
  } catch (error) {
    await pool.end();
    throw error;
  }
  return new PostgresRepositories(pool);
}
