/**
 * Repository contracts (dependency inversion). Services depend on these interfaces only,
 * so the same service code runs on PostgreSQL in production and in-memory in tests/evals.
 */
import type { LeadStatus } from '@gold/shared/constants';
import type { Lead, LeadProps } from '../domain/Lead.ts';
import type { LoanScheme } from '../domain/LoanScheme.ts';

/** Everything needed to create a lead; id, application id and status are assigned by the repository. */
export type LeadDraft = Omit<LeadProps, 'applicationId' | 'status'>;

export interface AuditEntry {
  applicationId: string;
  event: 'CREATED' | 'STATUS_CHANGED';
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  actor: string;
  /** FORM | AGENT for creations, null for status changes */
  channel: string | null;
  at: Date;
}

/** The recorded outcome of an Idempotency-Key request, replayed verbatim on retry. */
export interface StoredResponse {
  requestHash: string;
  statusCode: number;
  body: unknown;
}

/** Operations that must happen atomically inside the per-mobile critical section. */
export interface LeadTransaction {
  findRecentByMobile(mobileNumber: string, since: Date): Promise<Lead | null>;
  insertLead(draft: LeadDraft): Promise<Lead>;
  addAudit(entry: AuditEntry): Promise<void>;
  getStoredResponse(key: string): Promise<StoredResponse | null>;
  saveStoredResponse(key: string, response: StoredResponse): Promise<void>;
}

export interface LeadFilter {
  planId?: string | undefined;
  status?: LeadStatus | undefined;
}

export interface LeadPage {
  rows: Lead[];
  total: number;
}

export interface LeadRepository {
  /**
   * Run `work` while holding an exclusive lock for `lockKey` (the mobile number).
   * PostgreSQL: a transaction + pg_advisory_xact_lock. Memory: a promise-chain mutex.
   * This is what makes "exactly one 201 and one 409" true for parallel requests.
   */
  runExclusive<T>(lockKey: string, work: (tx: LeadTransaction) => Promise<T>): Promise<T>;
  findByApplicationId(applicationId: string): Promise<Lead | null>;
  findRecentByMobile(mobileNumber: string, since: Date): Promise<Lead | null>;
  list(filter: LeadFilter, page: number, pageSize: number): Promise<LeadPage>;
  /** Compare-and-set status change + audit entry. Returns null when the lead is not in `from`. */
  updateStatus(applicationId: string, from: LeadStatus, to: LeadStatus, actor: string, at: Date): Promise<Lead | null>;
  listAudit(applicationId: string): Promise<AuditEntry[]>;
}

export interface LoanSchemeRepository {
  listActive(): Promise<LoanScheme[]>;
  findActiveById(id: string): Promise<LoanScheme | null>;
}

export interface Repositories {
  readonly kind: 'postgres' | 'memory';
  readonly schemes: LoanSchemeRepository;
  readonly leads: LeadRepository;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
