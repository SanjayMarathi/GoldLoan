import { createHash } from 'node:crypto';
import { DUPLICATE_WINDOW_MS, LEAD_STATUSES } from '@gold/shared/constants';
import type { LeadStatus } from '@gold/shared/constants';
import { gramsToMg } from '@gold/shared/units';
import type { CreateLeadInput, LeadLookupInput, ListLeadsQuery } from '@gold/shared/schemas';
import type { AuditEntryDto, CreateLeadResponse, ErrorBody, LeadDetailDto, LeadDto, LeadListResponse, LeadSummaryDto } from '@gold/shared/types';
import type { Lead } from '../domain/Lead.ts';
import {
  DuplicateApplicationError,
  IdempotencyKeyReusedError,
  InvalidStatusTransitionError,
  NotFoundError,
} from '../lib/errors.ts';
import type { Clock } from '../lib/clock.ts';
import type { Logger } from '../lib/logger.ts';
import type { AuditEntry, LeadRepository } from '../repositories/interfaces.ts';
import type { QuoteService } from './QuoteService.ts';

export interface SubmitContext {
  /** Which front door the lead came through. Recorded in the audit log only – the lead itself is identical. */
  channel: 'FORM' | 'AGENT';
  idempotencyKey?: string | undefined;
  actor?: string;
}

export type SubmissionResult =
  | { statusCode: 201; replayed: boolean; body: CreateLeadResponse }
  | { statusCode: 409; replayed: boolean; body: ErrorBody };

export interface RecentApplication {
  applicationId: string;
  appliedAt: Date;
  status: LeadStatus;
}

export interface LeadServiceDeps {
  leads: LeadRepository;
  quotes: QuoteService;
  clock: Clock;
  logger: Logger;
}

export function toAuditDto(e: AuditEntry): AuditEntryDto {
  return {
    applicationId: e.applicationId,
    event: e.event,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actor: e.actor,
    channel: e.channel,
    at: e.at.toISOString(),
  };
}

function hashRequest(input: CreateLeadInput): string {
  const canonical = JSON.stringify([
    input.name.trim(),
    input.mobileNumber,
    gramsToMg(input.grossWeightGrams),
    gramsToMg(input.netWeightGrams),
    input.karat,
    input.planId,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Creates and manages leads. BOTH the REST route and the AI agent call `submit`, so a lead filed by
 * the chatbot is byte-for-byte the same as one filed through the form.
 */
export class LeadService {
  private readonly leads: LeadRepository;
  private readonly quotes: QuoteService;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(deps: LeadServiceDeps) {
    this.leads = deps.leads;
    this.quotes = deps.quotes;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  /**
   * 1. Plan must exist (404).
   * 2. The quote is RE-COMPUTED here from weight + karat – any client-sent number was already stripped.
   * 3. Inside a per-mobile lock: replay a stored Idempotency-Key response, else reject a duplicate
   *    within 7 days (409 + existing applicationId), else insert and audit.
   */
  async submit(input: CreateLeadInput, ctx: SubmitContext): Promise<SubmissionResult> {
    const { scheme, quote, rate } = await this.quotes.quoteForPlan(input, input.planId);
    const now = this.clock.now();
    const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS);
    const requestHash = hashRequest(input);

    const result = await this.leads.runExclusive(input.mobileNumber, async (tx): Promise<SubmissionResult> => {
      if (ctx.idempotencyKey) {
        const stored = await tx.getStoredResponse(ctx.idempotencyKey);
        if (stored) {
          if (stored.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
          return { statusCode: stored.statusCode, replayed: true, body: stored.body } as SubmissionResult;
        }
      }

      const existing = await tx.findRecentByMobile(input.mobileNumber, since);
      let outcome: SubmissionResult;
      if (existing) {
        outcome = {
          statusCode: 409,
          replayed: false,
          body: new DuplicateApplicationError(existing.applicationId, existing.createdAt).toBody(),
        };
      } else {
        const lead = await tx.insertLead({
          name: input.name.trim(),
          mobileNumber: input.mobileNumber,
          grossWeightMg: gramsToMg(input.grossWeightGrams),
          netWeightMg: gramsToMg(input.netWeightGrams),
          karat: input.karat,
          planId: scheme.id,
          planName: scheme.name,
          repaymentType: scheme.repaymentType,
          annualInterestBps: scheme.annualInterestBps,
          tenureMonths: scheme.tenureMonths,
          appliedLtvBps: quote.appliedLtvBps,
          ratePerGram24kPaise: rate.ratePerGram24kPaise,
          pureGoldMg: quote.pureGoldMg,
          goldValuePaise: quote.goldValuePaise,
          eligibleLoanRupees: quote.eligibleLoanRupees,
          createdAt: now,
        });
        const created: AuditEntry = {
          applicationId: lead.applicationId,
          event: 'CREATED',
          fromStatus: null,
          toStatus: 'SUBMITTED',
          actor: ctx.actor ?? 'applicant',
          channel: ctx.channel,
          at: now,
        };
        await tx.addAudit(created);
        const detail = this.toDetail(lead, [created]);
        outcome = {
          statusCode: 201,
          replayed: false,
          body: { applicationId: lead.applicationId, status: lead.status, createdAt: detail.createdAt, lead: detail },
        };
      }

      if (ctx.idempotencyKey) {
        await tx.saveStoredResponse(ctx.idempotencyKey, { requestHash, statusCode: outcome.statusCode, body: outcome.body });
      }
      return outcome;
    });

    this.logger.info(
      {
        outcome: result.statusCode === 201 ? 'created' : 'duplicate',
        replayed: result.replayed,
        channel: ctx.channel,
        planId: scheme.id,
        applicationId: result.statusCode === 201 ? result.body.applicationId : undefined,
      },
      'lead submission processed',
    );
    return result;
  }

  async list(query: ListLeadsQuery): Promise<LeadListResponse> {
    const { rows, total } = await this.leads.list({ planId: query.planId, status: query.status }, query.page, query.pageSize);
    return { data: rows.map((l) => this.toApiDto(l)), page: query.page, pageSize: query.pageSize, total };
  }

  /** Used by the agent's `check_existing_application` tool. Returns no personal data. */
  async findRecentApplication(mobileNumber: string): Promise<RecentApplication | null> {
    const since = new Date(this.clock.now().getTime() - DUPLICATE_WINDOW_MS);
    const lead = await this.leads.findRecentByMobile(mobileNumber, since);
    return lead ? { applicationId: lead.applicationId, appliedAt: lead.createdAt, status: lead.status } : null;
  }

  /** SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED, with an audit entry. */
  async transition(applicationId: string, to: LeadStatus, actor = 'admin'): Promise<LeadDto> {
    const lead = await this.leads.findByApplicationId(applicationId);
    if (!lead) throw new NotFoundError('LEAD_NOT_FOUND', `Application "${applicationId}" was not found.`, { applicationId });
    if (!lead.canTransitionTo(to)) throw new InvalidStatusTransitionError(lead.status, to);
    const updated = await this.leads.updateStatus(applicationId, lead.status, to, actor, this.clock.now());
    if (!updated) throw new InvalidStatusTransitionError(lead.status, to); // lost a race with another admin
    return this.toApiDto(updated);
  }

  /** Admin panel totals per status. */
  async summary(): Promise<LeadSummaryDto> {
    const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, { count: 0, loanRupees: 0 }])) as LeadSummaryDto['byStatus'];
    for (const row of await this.leads.summary()) byStatus[row.status] = { count: row.count, loanRupees: row.loanRupees };
    const all = Object.values(byStatus);
    return {
      total: all.reduce((n, s) => n + s.count, 0),
      totalLoanRupees: all.reduce((n, s) => n + s.loanRupees, 0),
      byStatus,
    };
  }

  getAudit(applicationId: string): Promise<AuditEntry[]> {
    return this.leads.listAudit(applicationId);
  }

  /** Admin view of one application: every stored figure, the repayment estimate and the full history. */
  async getDetail(applicationId: string): Promise<LeadDetailDto> {
    const lead = await this.leads.findByApplicationId(applicationId.trim().toUpperCase());
    if (!lead) throw new NotFoundError('LEAD_NOT_FOUND', `Application "${applicationId}" was not found.`, { applicationId });
    return this.toDetail(lead, await this.leads.listAudit(lead.applicationId));
  }

  /**
   * Applicant view: the application id AND the mobile number it was filed with must both match.
   * A wrong id and a wrong mobile get the same answer, so the endpoint cannot be used to discover applications.
   */
  async lookup(input: LeadLookupInput): Promise<LeadDetailDto> {
    const lead = await this.leads.findByApplicationId(input.applicationId);
    if (!lead || lead.mobileNumber !== input.mobileNumber) {
      throw new NotFoundError(
        'APPLICATION_NOT_FOUND',
        'We could not find an application with that ID and mobile number. Please check both and try again.',
      );
    }
    return this.toDetail(lead, await this.leads.listAudit(lead.applicationId));
  }

  /** Every lead leaves the API through here: stored fields (mobile masked) + its repayment figures. */
  private toApiDto(lead: Lead): LeadDto {
    return { ...lead.toDto(), indicative: this.quotes.indicativeFor(lead) };
  }

  private toDetail(lead: Lead, audit: AuditEntry[]): LeadDetailDto {
    return { ...this.toApiDto(lead), history: audit.map(toAuditDto) };
  }
}
