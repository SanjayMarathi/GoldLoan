import pg from 'pg';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { Lead } from '../domain/Lead.ts';
import { LoanScheme } from '../domain/LoanScheme.ts';
import type { LeadStatus, RepaymentType } from '@gold/shared/constants';
import type {
  AuditEntry,
  LeadDraft,
  LeadFilter,
  LeadPage,
  LeadRepository,
  LeadTransaction,
  LoanSchemeRepository,
  Repositories,
  StoredResponse,
} from './interfaces.ts';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

function rowToLead(r: QueryResultRow): Lead {
  return new Lead({
    applicationId: r.application_id,
    name: r.name,
    mobileNumber: r.mobile_number,
    grossWeightMg: Number(r.gross_weight_mg),
    netWeightMg: Number(r.net_weight_mg),
    karat: Number(r.karat),
    planId: r.plan_id,
    planName: r.plan_name,
    repaymentType: r.repayment_type as RepaymentType,
    annualInterestBps: Number(r.annual_interest_bps),
    tenureMonths: Number(r.tenure_months),
    appliedLtvBps: Number(r.applied_ltv_bps),
    ratePerGram24kPaise: Number(r.rate_per_gram_24k_paise),
    pureGoldMg: Number(r.pure_gold_mg),
    goldValuePaise: Number(r.gold_value_paise),
    eligibleLoanRupees: Number(r.loan_amount_rupees),
    status: r.status as LeadStatus,
    createdAt: new Date(r.created_at),
  });
}

function rowToScheme(r: QueryResultRow): LoanScheme {
  return new LoanScheme({
    id: r.id,
    name: r.name,
    repaymentType: r.repayment_type as RepaymentType,
    annualInterestBps: Number(r.annual_interest_bps),
    maxLtvBps: Number(r.max_ltv_bps),
    tenureMonths: Number(r.tenure_months),
    active: Boolean(r.active),
  });
}

const INSERT_LEAD = `
  INSERT INTO leads (
    application_id, name, mobile_number, gross_weight_mg, net_weight_mg, karat, plan_id, plan_name,
    repayment_type, annual_interest_bps, tenure_months, applied_ltv_bps,
    rate_per_gram_24k_paise, pure_gold_mg, gold_value_paise, loan_amount_rupees, status, created_at, updated_at
  ) VALUES (
    'GL-' || nextval('application_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
    'SUBMITTED', $16, $16
  ) RETURNING *`;

const INSERT_AUDIT = `
  INSERT INTO lead_audit (application_id, event, from_status, to_status, actor, channel, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

async function insertAudit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(INSERT_AUDIT, [e.applicationId, e.event, e.fromStatus, e.toStatus, e.actor, e.channel, e.at]);
}

async function recentByMobile(db: Queryable, mobile: string, since: Date): Promise<Lead | null> {
  const { rows } = await db.query(
    'SELECT * FROM leads WHERE mobile_number = $1 AND created_at > $2 ORDER BY created_at DESC, id DESC LIMIT 1',
    [mobile, since],
  );
  return rows[0] ? rowToLead(rows[0]) : null;
}

/** Operations executed on ONE client inside a transaction that already holds the advisory lock. */
class PgLeadTransaction implements LeadTransaction {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  findRecentByMobile(mobileNumber: string, since: Date): Promise<Lead | null> {
    return recentByMobile(this.client, mobileNumber, since);
  }

  async insertLead(d: LeadDraft): Promise<Lead> {
    const { rows } = await this.client.query(INSERT_LEAD, [
      d.name,
      d.mobileNumber,
      d.grossWeightMg,
      d.netWeightMg,
      d.karat,
      d.planId,
      d.planName,
      d.repaymentType,
      d.annualInterestBps,
      d.tenureMonths,
      d.appliedLtvBps,
      d.ratePerGram24kPaise,
      d.pureGoldMg,
      d.goldValuePaise,
      d.eligibleLoanRupees,
      d.createdAt,
    ]);
    return rowToLead(rows[0]!);
  }

  addAudit(entry: AuditEntry): Promise<void> {
    return insertAudit(this.client, entry);
  }

  async getStoredResponse(key: string): Promise<StoredResponse | null> {
    const { rows } = await this.client.query(
      'SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE key = $1',
      [key],
    );
    const r = rows[0];
    return r ? { requestHash: r.request_hash, statusCode: Number(r.status_code), body: r.response_body } : null;
  }

  async saveStoredResponse(key: string, response: StoredResponse): Promise<void> {
    await this.client.query(
      `INSERT INTO idempotency_keys (key, request_hash, status_code, response_body)
       VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (key) DO NOTHING`,
      [key, response.requestHash, response.statusCode, JSON.stringify(response.body)],
    );
  }
}

export class PostgresLoanSchemeRepository implements LoanSchemeRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listActive(): Promise<LoanScheme[]> {
    const { rows } = await this.pool.query('SELECT * FROM loan_schemes WHERE active ORDER BY sort_order, id');
    return rows.map(rowToScheme);
  }

  async findActiveById(id: string): Promise<LoanScheme | null> {
    const { rows } = await this.pool.query('SELECT * FROM loan_schemes WHERE active AND id = $1', [id]);
    return rows[0] ? rowToScheme(rows[0]) : null;
  }
}

export class PostgresLeadRepository implements LeadRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * BEGIN → pg_advisory_xact_lock(hash(mobile)) → work → COMMIT.
   * Two parallel requests for the same mobile queue on the lock; the second one then sees the
   * first one's committed row and returns 409. Different mobiles never block each other.
   */
  async runExclusive<T>(lockKey: string, work: (tx: LeadTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      const result = await work(new PgLeadTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already broken – nothing to roll back */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findByApplicationId(applicationId: string): Promise<Lead | null> {
    const { rows } = await this.pool.query('SELECT * FROM leads WHERE application_id = $1', [applicationId]);
    return rows[0] ? rowToLead(rows[0]) : null;
  }

  findRecentByMobile(mobileNumber: string, since: Date): Promise<Lead | null> {
    return recentByMobile(this.pool, mobileNumber, since);
  }

  async list(filter: LeadFilter, page: number, pageSize: number): Promise<LeadPage> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.planId) {
      params.push(filter.planId);
      where.push(`plan_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const count = await this.pool.query(`SELECT count(*)::int AS total FROM leads ${clause}`, params);
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const { rows } = await this.pool.query(
      `SELECT * FROM leads ${clause} ORDER BY created_at DESC, id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return { rows: rows.map(rowToLead), total: Number(count.rows[0]?.total ?? 0) };
  }

  async updateStatus(applicationId: string, from: LeadStatus, to: LeadStatus, actor: string, at: Date): Promise<Lead | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE leads SET status = $3, updated_at = $4 WHERE application_id = $1 AND status = $2 RETURNING *',
        [applicationId, from, to, at],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await insertAudit(client, { applicationId, event: 'STATUS_CHANGED', fromStatus: from, toStatus: to, actor, channel: null, at });
      await client.query('COMMIT');
      return rowToLead(rows[0]);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listAudit(applicationId: string): Promise<AuditEntry[]> {
    const { rows } = await this.pool.query('SELECT * FROM lead_audit WHERE application_id = $1 ORDER BY id', [applicationId]);
    return rows.map((r) => ({
      applicationId: r.application_id,
      event: r.event,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      actor: r.actor,
      channel: r.channel,
      at: new Date(r.created_at),
    }));
  }
}

export class PostgresRepositories implements Repositories {
  readonly kind = 'postgres' as const;
  readonly schemes: PostgresLoanSchemeRepository;
  readonly leads: PostgresLeadRepository;
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
    this.schemes = new PostgresLoanSchemeRepository(pool);
    this.leads = new PostgresLeadRepository(pool);
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}
