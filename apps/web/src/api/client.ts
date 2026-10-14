/** Thin, typed fetch wrapper. Every failure becomes an ApiError with the server's code / fields. */
import type {
  AuditEntryDto,
  CreateLeadResponse,
  ChatReplyDto,
  ErrorBody,
  FieldError,
  GoldRateResponse,
  LeadDetailDto,
  LeadDto,
  LeadListResponse,
  LeadSummaryDto,
  LoanSchemeDto,
  QuoteResponse,
} from '@gold/shared/types';
import type { CreateLeadInput, LeadLookupInput, QuoteRequest } from '@gold/shared/schemas';
import type { LeadStatus } from '@gold/shared/constants';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldError[];
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, fields: FieldError[] = [], details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

export const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!response.ok) {
    const e = (body as ErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? 'Something went wrong. Please try again.',
      e?.fields ?? [],
      e?.details,
    );
  }
  return body as T;
}

const post = (body: unknown, extra: RequestInit = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(body), ...extra });

export interface HealthDto {
  status: 'ok' | 'degraded';
  storage: string;
  assistant: string;
}

export const api = {
  schemes: () => request<{ data: LoanSchemeDto[] }>('/loan-schemes'),
  goldRate: () => request<GoldRateResponse>('/gold-rate'),
  quote: (input: QuoteRequest, signal?: AbortSignal) => request<QuoteResponse>('/quotes', post(input, signal ? { signal } : {})),
  createLead: (input: CreateLeadInput, idempotencyKey: string) =>
    request<CreateLeadResponse>('/leads', post(input, { headers: { 'Idempotency-Key': idempotencyKey } })),
  listLeads: (params: { page: number; pageSize: number; planId?: string; status?: string }, signal?: AbortSignal) => {
    const q = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.planId) q.set('planId', params.planId);
    if (params.status) q.set('status', params.status);
    return request<LeadListResponse>(`/leads?${q.toString()}`, signal ? { signal } : {});
  },
  updateStatus: (applicationId: string, status: LeadStatus) =>
    request<LeadDto>(`/leads/${encodeURIComponent(applicationId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  audit: (applicationId: string) => request<{ data: AuditEntryDto[] }>(`/leads/${encodeURIComponent(applicationId)}/audit`),
  /** Admin panel totals per status */
  summary: (signal?: AbortSignal) => request<LeadSummaryDto>('/leads/summary', signal ? { signal } : {}),
  /** Admin: one application with repayment figures and full history */
  lead: (applicationId: string, signal?: AbortSignal) =>
    request<LeadDetailDto>(`/leads/${encodeURIComponent(applicationId)}`, signal ? { signal } : {}),
  /** Applicant: track my application (id + the mobile it was filed with) */
  lookup: (input: LeadLookupInput) => request<LeadDetailDto>('/leads/lookup', post(input)),
  chat: (sessionId: string | undefined, message: string) => request<ChatReplyDto>('/chat', post({ sessionId, message })),
  confirm: (sessionId: string, actionId: string, decision: 'confirm' | 'cancel') =>
    request<ChatReplyDto>('/chat/confirm', post({ sessionId, actionId, decision })),
  health: (signal?: AbortSignal) => request<HealthDto>('/health', signal ? { signal } : {}),
};
