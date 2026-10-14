/** Form state ↔ validated payload. Uses the SAME Zod schema as the server, so messages match exactly. */
import { CreateLeadSchema, zodToFieldErrors } from '@gold/shared/schemas';
import type { Karat } from '@gold/shared/constants';
import type { CreateLeadInput } from '@gold/shared/schemas';

export interface DetailsValues {
  name: string;
  mobile: string;
  gross: string;
  net: string;
  karat: Karat;
}

export const EMPTY_DETAILS: DetailsValues = { name: '', mobile: '', gross: '', net: '', karat: 22 };

export type DetailsField = 'name' | 'mobileNumber' | 'grossWeightGrams' | 'netWeightGrams' | 'karat';
export type DetailsErrors = Partial<Record<DetailsField, string>>;

/** "45", "45.5", "45,5" → number; "" or junk → undefined (so the schema says "required" / "must be a number"). */
export function toWeight(raw: string): number | undefined {
  const cleaned = raw.trim().replace(',', '.');
  if (cleaned === '') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function toNumberOrNull(raw: string): number | null {
  const n = toWeight(raw);
  return n === undefined || Number.isNaN(n) ? null : n;
}

export function validateDetails(v: DetailsValues): DetailsErrors {
  const result = CreateLeadSchema.safeParse({
    name: v.name,
    mobileNumber: v.mobile,
    grossWeightGrams: toWeight(v.gross),
    netWeightGrams: toWeight(v.net),
    karat: v.karat,
    planId: 'PLAN_PLACEHOLDER', // the plan is chosen in step 2
  });
  if (result.success) return {};
  const errors: DetailsErrors = {};
  for (const { field, message } of zodToFieldErrors(result.error)) {
    if (field !== 'planId') errors[field as DetailsField] = message;
  }
  return errors;
}

export function toPayload(v: DetailsValues, planId: string): CreateLeadInput {
  return {
    name: v.name.trim(),
    mobileNumber: v.mobile,
    grossWeightGrams: toWeight(v.gross) as number,
    netWeightGrams: toWeight(v.net) as number,
    karat: v.karat,
    planId,
  };
}

/** Keep only what makes sense while typing. */
export const digitsOnly = (s: string, max: number): string => s.replace(/\D/g, '').slice(0, max);
export const weightText = (s: string): string => {
  const t = s.replace(/[^\d.,]/g, '').replace(',', '.');
  const [whole = '', ...rest] = t.split('.');
  return rest.length > 0 ? `${whole.slice(0, 4)}.${rest.join('').slice(0, 3)}` : whole.slice(0, 4);
};
