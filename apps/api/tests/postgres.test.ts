/**
 * Runs the concurrency-critical scenarios against a REAL PostgreSQL (advisory locks, transactions, constraints).
 * Skipped unless TEST_DATABASE_URL is set, e.g.
 *
 *   docker compose up -d db
 *   TEST_DATABASE_URL=postgresql://gold:gold@localhost:5432/goldloan npm test -w apps/api
 *
 * The leads tables of that database are emptied first – use a throw-away database, never production.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { loadConfig } from '../src/config.ts';
import { buildContainer } from '../src/container.ts';
import type { Container } from '../src/container.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { createNoopLogger } from '../src/lib/noopLogger.ts';
import { VALID_LEAD } from './helpers.ts';

const URL = process.env.TEST_DATABASE_URL;

describe('PostgreSQL repositories', { skip: URL ? false : 'set TEST_DATABASE_URL to run against a real database' }, () => {
  let pool: Pool;
  let container: Container;
  let clock: FakeClock;

  before(async () => {
    const { createPool, PostgresRepositories } = await import('../src/repositories/postgres.ts');
    const { runMigrations } = await import('../src/db/migrate.ts');
    const { seedSchemes } = await import('../src/db/seed.ts');
    pool = createPool(URL!);
    await runMigrations(pool, () => undefined);
    await seedSchemes(pool, () => undefined);
    clock = new FakeClock('2026-10-01T09:00:00.000Z');
    container = buildContainer(loadConfig({ LLM_PROVIDER: 'offline', DB_DRIVER: 'memory' }), {
      logger: createNoopLogger(),
      clock,
      repositories: new PostgresRepositories(pool),
    });
  });

  const reset = async (): Promise<void> => {
    await pool.query('TRUNCATE leads, lead_audit, idempotency_keys RESTART IDENTITY CASCADE');
    await pool.query('ALTER SEQUENCE application_seq RESTART WITH 1001');
  };

  after(async () => {
    await pool?.end();
  });

  it('creates a lead with GL-1001 and the exact PDF amount, then rejects a repeat with 409', async () => {
    await reset();
    const first = await container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    assert.equal(first.statusCode, 201);
    if (first.statusCode === 201) {
      assert.equal(first.body.applicationId, 'GL-1001');
      assert.equal(first.body.lead.eligibleLoanRupees, 216_562);
    }
    clock.advanceDays(2);
    const dup = await container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    assert.equal(dup.statusCode, 409);
    if (dup.statusCode === 409) assert.equal(dup.body.error.details?.applicationId, 'GL-1001');
  });

  it('allows the same mobile again after 7 days', async () => {
    await reset();
    await container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    clock.advanceDays(8);
    assert.equal((await container.leadService.submit(VALID_LEAD, { channel: 'FORM' })).statusCode, 201);
  });

  it('case 8: 2 parallel requests → exactly one 201 and one 409', async () => {
    await reset();
    const results = await Promise.all([
      container.leadService.submit(VALID_LEAD, { channel: 'FORM' }),
      container.leadService.submit(VALID_LEAD, { channel: 'FORM' }),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  });

  it('25 parallel requests for one mobile → exactly one row in the table', async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 25 }, () => container.leadService.submit(VALID_LEAD, { channel: 'FORM' })));
    assert.equal(results.filter((r) => r.statusCode === 201).length, 1);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM leads');
    assert.equal(rows[0].n, 1);
  });

  it('different mobiles submitted in parallel all succeed (the lock is per mobile, not global)', async () => {
    await reset();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => container.leadService.submit({ ...VALID_LEAD, mobileNumber: `90000000${10 + i}` }, { channel: 'FORM' })),
    );
    assert.equal(results.every((r) => r.statusCode === 201), true);
    assert.equal(new Set(results.map((r) => (r.statusCode === 201 ? r.body.applicationId : ''))).size, 10, 'unique application ids');
  });

  it('case 7: Idempotency-Key replays the stored 201', async () => {
    await reset();
    const key = 'pg-idem-key-0001';
    const a = await container.leadService.submit(VALID_LEAD, { channel: 'FORM', idempotencyKey: key });
    clock.advanceDays(30);
    const b = await container.leadService.submit(VALID_LEAD, { channel: 'FORM', idempotencyKey: key });
    assert.equal(a.statusCode, 201);
    assert.equal(b.statusCode, 201);
    assert.equal(b.replayed, true);
    assert.equal((await container.leadService.list({ page: 1, pageSize: 10 })).total, 1);
  });

  it('lists newest first with masked mobiles and filters by plan', async () => {
    await reset();
    for (const [i, m] of ['9000000001', '9000000002', '9000000003'].entries()) {
      clock.advanceMs(1000);
      await container.leadService.submit({ ...VALID_LEAD, mobileNumber: m, planId: i === 0 ? 'PLAN_BULLET_01' : 'PLAN_EMI_01' }, { channel: 'FORM' });
    }
    const all = await container.leadService.list({ page: 1, pageSize: 10 });
    assert.equal(all.data[0]!.mobileNumber, '9000XXXX03');
    assert.equal((await container.leadService.list({ page: 1, pageSize: 10, planId: 'PLAN_BULLET_01' })).total, 1);
  });

  it('status workflow is compare-and-set and writes the audit log', async () => {
    await reset();
    const created = await container.leadService.submit(VALID_LEAD, { channel: 'AGENT' });
    assert.equal(created.statusCode, 201);
    if (created.statusCode !== 201) return;
    const id = created.body.applicationId;
    await container.leadService.transition(id, 'UNDER_REVIEW');
    await container.leadService.transition(id, 'APPROVED');
    const audit = await container.leadService.getAudit(id);
    assert.deepEqual(audit.map((a) => a.toStatus), ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);
  });

  it('stores the plan terms with the lead (migration 002) and serves the full detail after approval', async () => {
    await reset();
    const created = await container.leadService.submit({ ...VALID_LEAD, planId: 'PLAN_BULLET_01' }, { channel: 'FORM' });
    assert.equal(created.statusCode, 201);
    if (created.statusCode !== 201) return;
    const id = created.body.applicationId;
    const { rows } = await pool.query(
      'SELECT repayment_type, annual_interest_bps, tenure_months, applied_ltv_bps FROM leads WHERE application_id = $1',
      [id],
    );
    assert.deepEqual(rows[0], { repayment_type: 'BULLET', annual_interest_bps: 1200, tenure_months: 12, applied_ltv_bps: 7000 });

    await container.leadService.transition(id, 'UNDER_REVIEW');
    await container.leadService.transition(id, 'APPROVED');
    const detail = await container.leadService.lookup({ applicationId: id, mobileNumber: VALID_LEAD.mobileNumber });
    assert.equal(detail.status, 'APPROVED');
    assert.equal(detail.indicative.totalInterestPaise, 2_425_500);
    assert.deepEqual(detail.history.map((e) => e.toStatus), ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);
    await assert.rejects(pool.query('UPDATE leads SET applied_ltv_bps = 9000 WHERE application_id = $1', [id]), /check constraint/i);
  });

  it('summarises applications per status for the admin panel', async () => {
    await reset();
    await container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    const second = await container.leadService.submit({ ...VALID_LEAD, mobileNumber: '9123456780', planId: 'PLAN_BULLET_01' }, { channel: 'FORM' });
    if (second.statusCode === 201) await container.leadService.transition(second.body.applicationId, 'UNDER_REVIEW');
    const s = await container.leadService.summary();
    assert.equal(s.total, 2);
    assert.deepEqual(s.byStatus.SUBMITTED, { count: 1, loanRupees: 216_562 });
    assert.deepEqual(s.byStatus.UNDER_REVIEW, { count: 1, loanRupees: 202_125 });
    assert.equal(s.totalLoanRupees, 418_687);
  });

  it('the database itself refuses a loan plan above the 75% cap', async () => {
    await assert.rejects(
      pool.query("INSERT INTO loan_schemes (id, name, repayment_type, annual_interest_bps, max_ltv_bps, tenure_months) VALUES ('BAD', 'Bad', 'EMI', 1000, 9000, 12)"),
      /check constraint/i,
    );
  });
});
