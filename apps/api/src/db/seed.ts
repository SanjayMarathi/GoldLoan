/** Idempotent seed: upserts the two assignment plans.   npm run db:seed */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { loadConfig } from '../config.ts';
import { createPool } from '../repositories/postgres.ts';
import { loadEnvFiles } from './loadEnv.ts';
import { SEED_SCHEMES } from './seedData.ts';

export async function seedSchemes(pool: Pool, log: (msg: string) => void = console.log): Promise<void> {
  for (const s of SEED_SCHEMES) {
    await pool.query(
      `INSERT INTO loan_schemes (id, name, repayment_type, annual_interest_bps, max_ltv_bps, tenure_months, active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         repayment_type = EXCLUDED.repayment_type,
         annual_interest_bps = EXCLUDED.annual_interest_bps,
         max_ltv_bps = EXCLUDED.max_ltv_bps,
         tenure_months = EXCLUDED.tenure_months,
         active = EXCLUDED.active,
         sort_order = EXCLUDED.sort_order`,
      [s.id, s.name, s.repaymentType, s.annualInterestBps, s.maxLtvBps, s.tenureMonths, s.active, s.sortOrder],
    );
    log(`seeded ${s.id}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvFiles();
  const config = loadConfig();
  if (!config.db.url) {
    console.error('DATABASE_URL is not set – nothing to seed.');
    process.exit(1);
  }
  const pool = createPool(config.db.url);
  seedSchemes(pool)
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error.message);
      await pool.end();
      process.exit(1);
    });
}
