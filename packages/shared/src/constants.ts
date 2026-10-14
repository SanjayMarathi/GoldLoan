/** Business constants shared by the API, the agent and the UI. Zero dependencies. */

export const KARATS = [18, 22, 24] as const;
export type Karat = (typeof KARATS)[number];

export function isKarat(value: unknown): value is Karat {
  return typeof value === 'number' && (KARATS as readonly number[]).includes(value);
}

/** RBI cap: no loan may exceed 75% of the gold value. Stored as basis points (1% = 100 bps). */
export const MAX_LTV_BPS = 7500;

/** The same mobile number may not apply again within this many days. */
export const DUPLICATE_WINDOW_DAYS = 7;
export const DUPLICATE_WINDOW_MS = DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const MAX_GROSS_GRAMS = 1000;

/** Indian mobile: 10 digits, first digit 6-9. */
export const MOBILE_REGEX = /^[6-9]\d{9}$/;

/** Letters (any script) and spaces only. Length is validated separately. */
export const NAME_REGEX = /^[\p{L}\p{M} ]+$/u;
export const NAME_MIN = 2;
export const NAME_MAX = 60;

export const LEAD_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Allowed status workflow: SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED */
export const STATUS_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export const REPAYMENT_TYPES = ['BULLET', 'EMI'] as const;
export type RepaymentType = (typeof REPAYMENT_TYPES)[number];

export const PLAN_BULLET_ID = 'PLAN_BULLET_01';
export const PLAN_EMI_ID = 'PLAN_EMI_01';

export const QUOTE_DISCLAIMER =
  'Indicative estimate only. The final loan amount is decided after physical appraisal of the gold and is not a promise of approval.';
