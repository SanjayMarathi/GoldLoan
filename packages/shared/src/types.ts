/** DTOs: the exact JSON shapes that cross the API boundary. */
import type { LeadStatus, RepaymentType } from './constants.ts';

export interface FieldError {
  field: string;
  message: string;
}

/** Every error response from the API has exactly this shape. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields: FieldError[];
    details?: Record<string, unknown>;
  };
}

export interface LoanSchemeDto {
  id: string;
  name: string;
  repaymentType: RepaymentType;
  annualInterestPercent: number;
  tenureMonths: number;
  maxLtvPercent: number;
}

export interface IndicativeRepaymentDto {
  totalInterestPaise: number;
  totalRepayablePaise: number;
  /** Only for EMI plans */
  monthlyEmiPaise: number | null;
}

export interface PlanQuoteDto {
  planId: string;
  planName: string;
  repaymentType: RepaymentType;
  tenureMonths: number;
  annualInterestPercent: number;
  planMaxLtvPercent: number;
  /** min(plan max LTV, 75%) – the LTV actually applied */
  appliedLtvPercent: number;
  pureGoldMg: number;
  goldValuePaise: number;
  /** Whole rupees, floored */
  eligibleLoanRupees: number;
  indicative: IndicativeRepaymentDto;
}

export interface QuoteResponse {
  netWeightGrams: number;
  grossWeightGrams: number;
  karat: number;
  ratePerGram24kPaise: number;
  pureGoldMg: number;
  goldValuePaise: number;
  plans: PlanQuoteDto[];
  disclaimer: string;
}

/**
 * A lead as returned by the API. `mobileNumber` is ALWAYS masked (9876XXXX10).
 * The plan terms are a snapshot taken when the application was filed, so the offer never changes afterwards.
 */
export interface LeadDto {
  applicationId: string;
  name: string;
  mobileNumber: string;
  netWeightGrams: number;
  grossWeightGrams: number;
  karat: number;
  planId: string;
  planName: string;
  repaymentType: RepaymentType;
  annualInterestPercent: number;
  tenureMonths: number;
  /** min(plan max LTV, 75%) – the LTV actually applied */
  appliedLtvPercent: number;
  ratePerGram24kPaise: number;
  pureGoldMg: number;
  goldValuePaise: number;
  eligibleLoanRupees: number;
  /** EMI / interest, computed from the saved plan terms with the same maths as the quote */
  indicative: IndicativeRepaymentDto;
  status: LeadStatus;
  createdAt: string;
}

/** The stored part of a lead (what the domain object serialises); the API adds `indicative`. */
export type LeadRecordDto = Omit<LeadDto, 'indicative'>;

/** One line of a lead's history (creation or status change). */
export interface AuditEntryDto {
  applicationId: string;
  event: 'CREATED' | 'STATUS_CHANGED';
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  actor: string;
  /** FORM | AGENT for creations, null for status changes */
  channel: string | null;
  at: string;
}

/** Everything about one application: the stored lead, its repayment figures and its history. */
export interface LeadDetailDto extends LeadDto {
  history: AuditEntryDto[];
}

export interface CreateLeadResponse {
  applicationId: string;
  status: LeadStatus;
  createdAt: string;
  lead: LeadDetailDto;
}

export interface LeadListResponse {
  data: LeadDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface GoldRateResponse {
  ratePerGram24kPaise: number;
  source: string;
  asOf: string;
}

/* ───────────── AI chat ───────────── */

export interface ApplicationSummaryDto {
  name: string;
  mobileNumberMasked: string;
  netWeightGrams: number;
  grossWeightGrams: number;
  karat: number;
  planId: string;
  planName: string;
  repaymentType: RepaymentType;
  interestPercent: number;
  tenureMonths: number;
  appliedLtvPercent: number;
  pureGoldMg: number;
  goldValuePaise: number;
  eligibleLoanRupees: number;
  indicative: IndicativeRepaymentDto;
}

export interface PendingConfirmationDto {
  actionId: string;
  summary: ApplicationSummaryDto;
}

export interface ChatToolEvent {
  tool: string;
  status: 'ok' | 'error';
  label: string;
}

export interface ChatReplyDto {
  sessionId: string;
  reply: string;
  toolEvents: ChatToolEvent[];
  pendingConfirmation: PendingConfirmationDto | null;
  /** Set once an application has been filed through the chat */
  submitted: { applicationId: string; eligibleLoanRupees: number } | null;
  provider: string;
  degraded: boolean;
}
