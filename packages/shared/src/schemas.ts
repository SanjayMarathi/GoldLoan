/**
 * Zod schemas. ONE source of truth: the REST API validates requests with them,
 * and the AI agent validates tool arguments with the very same objects.
 */
import { z } from 'zod';
import type { ZodError } from 'zod';
import {
  LEAD_STATUSES,
  MAX_GROSS_GRAMS,
  MOBILE_REGEX,
  NAME_MAX,
  NAME_MIN,
  NAME_REGEX,
  isKarat,
} from './constants.ts';
import { hasAtMostThreeDecimals } from './units.ts';
import type { FieldError } from './types.ts';

const weight = (label: string) =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .finite(`${label} must be a number`)
    .positive(`${label} must be greater than 0`)
    .max(MAX_GROSS_GRAMS, `${label} cannot exceed ${MAX_GROSS_GRAMS} g`)
    .refine(hasAtMostThreeDecimals, `${label} can have at most 3 decimal places`);

const karat = z
  .number({ required_error: 'Karat is required', invalid_type_error: 'Karat must be 18, 22 or 24' })
  .refine(isKarat, 'Karat must be 18, 22 or 24');

const name = z
  .string({ required_error: 'Name is required', invalid_type_error: 'Name must be text' })
  .trim()
  .min(NAME_MIN, `Name must be at least ${NAME_MIN} characters`)
  .max(NAME_MAX, `Name must be at most ${NAME_MAX} characters`)
  .regex(NAME_REGEX, 'Name can contain only letters and spaces');

const mobileNumber = z
  .string({ required_error: 'Mobile number is required', invalid_type_error: 'Mobile number must be text' })
  .trim()
  .regex(MOBILE_REGEX, 'Enter a valid 10-digit Indian mobile number starting with 6-9');

const weightShape = {
  grossWeightGrams: weight('Gross weight'),
  netWeightGrams: weight('Net weight'),
  karat,
};

/** 0 < net ≤ gross. The error is attached to `netWeightGrams`. */
function netNotAboveGross(v: { netWeightGrams: number; grossWeightGrams: number }, ctx: z.RefinementCtx): void {
  if (v.netWeightGrams > v.grossWeightGrams) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['netWeightGrams'],
      message: 'Net weight cannot be more than gross weight',
    });
  }
}

/** POST /quotes body, and the arguments of the `calculate_quote` agent tool. */
export const QuoteRequestSchema = z.object(weightShape).superRefine(netNotAboveGross);
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

/**
 * POST /leads body, and the arguments of the `submit_application` agent tool.
 * Unknown keys (e.g. a client-sent `eligibleLoan`) are stripped: the server never trusts client numbers.
 */
export const CreateLeadSchema = z
  .object({
    name,
    mobileNumber,
    ...weightShape,
    planId: z
      .string({ required_error: 'Plan is required', invalid_type_error: 'Plan must be text' })
      .trim()
      .min(1, 'Plan is required')
      .max(64),
  })
  .superRefine(netNotAboveGross);
export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;

export const ListLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  planId: z.string().trim().min(1).max(64).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
});
export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema>;

export const UpdateLeadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES, { errorMap: () => ({ message: `Status must be one of ${LEAD_STATUSES.join(', ')}` }) }),
});

export const ChatMessageRequestSchema = z.object({
  sessionId: z.string().trim().min(8).max(64).optional(),
  message: z
    .string({ required_error: 'Message is required', invalid_type_error: 'Message must be text' })
    .trim()
    .min(1, 'Message cannot be empty')
    .max(1000, 'Message is too long (max 1000 characters)'),
});

export const ChatConfirmRequestSchema = z.object({
  sessionId: z.string().trim().min(8).max(64),
  actionId: z.string().trim().min(8).max(64),
  decision: z.enum(['confirm', 'cancel']),
});

export const MobileLookupSchema = z.object({ mobileNumber });

/** GL-1001. Accepts lower case and stray spaces, stores upper case. */
const applicationId = z
  .string({ required_error: 'Application ID is required', invalid_type_error: 'Application ID must be text' })
  .trim()
  .toUpperCase()
  .regex(/^GL-\d{4,10}$/, 'Application ID looks like GL-1001');

/** POST /leads/lookup – an applicant checks their own application. Both fields must match. */
export const LeadLookupSchema = z.object({ applicationId, mobileNumber });
export type LeadLookupInput = z.infer<typeof LeadLookupSchema>;

/** ZodError → [{ field: 'netWeightGrams', message }] (first message per field wins). */
export function zodToFieldErrors(error: ZodError): FieldError[] {
  const seen = new Set<string>();
  const out: FieldError[] = [];
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_root';
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ field, message: issue.message });
  }
  return out;
}
