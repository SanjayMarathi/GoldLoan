import { Lead } from '../domain/Lead.ts';
import { LoanScheme } from '../domain/LoanScheme.ts';
import { SEED_SCHEMES } from '../db/seedData.ts';
import type { LeadStatus } from '@gold/shared/constants';
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

export class MemoryLoanSchemeRepository implements LoanSchemeRepository {
  private readonly schemes: LoanScheme[];

  constructor() {
    this.schemes = [...SEED_SCHEMES]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => new LoanScheme(s));
  }

  async listActive(): Promise<LoanScheme[]> {
    return this.schemes.filter((s) => s.active);
  }

  async findActiveById(id: string): Promise<LoanScheme | null> {
    return this.schemes.find((s) => s.active && s.id === id) ?? null;
  }
}

export class MemoryLeadRepository implements LeadRepository {
  private readonly leads: Lead[] = [];
  private readonly audit: AuditEntry[] = [];
  private readonly idempotency = new Map<string, StoredResponse>();
  private readonly locks = new Map<string, Promise<void>>();
  private nextSeq = 1001;

  private readonly tx: LeadTransaction = {
    findRecentByMobile: async (mobile, since) => this.recentByMobile(mobile, since),
    insertLead: async (draft) => this.insert(draft),
    addAudit: async (entry) => {
      this.audit.push(entry);
    },
    getStoredResponse: async (key) => this.idempotency.get(key) ?? null,
    saveStoredResponse: async (key, response) => {
      if (!this.idempotency.has(key)) this.idempotency.set(key, response);
    },
  };

  /** Per-key mutex built from a promise chain: callers run strictly one after another. */
  async runExclusive<T>(lockKey: string, work: (tx: LeadTransaction) => Promise<T>): Promise<T> {
    const previous = this.locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.locks.set(lockKey, tail);
    await previous;
    try {
      return await work(this.tx);
    } finally {
      release();
      if (this.locks.get(lockKey) === tail) this.locks.delete(lockKey);
    }
  }

  async findByApplicationId(applicationId: string): Promise<Lead | null> {
    return this.leads.find((l) => l.applicationId === applicationId) ?? null;
  }

  async findRecentByMobile(mobileNumber: string, since: Date): Promise<Lead | null> {
    return this.recentByMobile(mobileNumber, since);
  }

  async list(filter: LeadFilter, page: number, pageSize: number): Promise<LeadPage> {
    const matching = this.leads
      .filter((l) => (filter.planId ? l.planId === filter.planId : true))
      .filter((l) => (filter.status ? l.status === filter.status : true));
    // newest first: createdAt desc, then insertion order desc
    const ordered = matching
      .map((lead, index) => ({ lead, index }))
      .sort((a, b) => b.lead.createdAt.getTime() - a.lead.createdAt.getTime() || b.index - a.index)
      .map((x) => x.lead);
    const start = (page - 1) * pageSize;
    return { rows: ordered.slice(start, start + pageSize), total: ordered.length };
  }

  async updateStatus(applicationId: string, from: LeadStatus, to: LeadStatus, actor: string, at: Date): Promise<Lead | null> {
    const index = this.leads.findIndex((l) => l.applicationId === applicationId);
    const current = this.leads[index];
    if (index === -1 || !current || current.status !== from) return null;
    const updated = current.withStatus(to);
    this.leads[index] = updated;
    this.audit.push({ applicationId, event: 'STATUS_CHANGED', fromStatus: from, toStatus: to, actor, channel: null, at });
    return updated;
  }

  async listAudit(applicationId: string): Promise<AuditEntry[]> {
    return this.audit.filter((a) => a.applicationId === applicationId);
  }

  private recentByMobile(mobileNumber: string, since: Date): Lead | null {
    let best: Lead | null = null;
    for (const lead of this.leads) {
      if (lead.mobileNumber !== mobileNumber || lead.createdAt.getTime() <= since.getTime()) continue;
      if (!best || lead.createdAt.getTime() >= best.createdAt.getTime()) best = lead;
    }
    return best;
  }

  private insert(draft: LeadDraft): Lead {
    const lead = new Lead({ ...draft, applicationId: `GL-${this.nextSeq++}`, status: 'SUBMITTED' });
    this.leads.push(lead);
    return lead;
  }
}

export class MemoryRepositories implements Repositories {
  readonly kind = 'memory' as const;
  readonly schemes = new MemoryLoanSchemeRepository();
  readonly leads = new MemoryLeadRepository();

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
