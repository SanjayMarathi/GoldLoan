/** PII masking. Used for API responses, log lines and anything shown outside the database. */

/** 9876543210 → 9876XXXX10 */
export function maskMobile(mobile: string): string {
  const s = String(mobile ?? '');
  if (/^\d{10}$/.test(s)) return `${s.slice(0, 4)}XXXX${s.slice(8)}`;
  if (s.length > 2) return `${'X'.repeat(s.length - 2)}${s.slice(-2)}`;
  return 'XXXX';
}

const TEN_DIGITS = /(?<!\d)\d{10}(?!\d)/g;

/** Replace every 10-digit run inside free text (log messages, chat text) with its masked form. */
export function scrubPII(text: string): string {
  return text.replace(TEN_DIGITS, (m) => maskMobile(m));
}

const SENSITIVE_KEY = /mobile|phone|msisdn/i;
const MAX_DEPTH = 6;

/** Deep-copy a value, masking mobile-ish keys and 10-digit runs in strings. Safe for logging. */
export function scrubDeep(value: unknown, key = '', depth = 0): unknown {
  if (value == null) return value;
  if (value instanceof Error) {
    // Error fields are non-enumerable, so copy them explicitly (and scrub them).
    return { type: value.name, message: scrubPII(value.message), stack: value.stack ? scrubPII(value.stack) : undefined };
  }
  if (typeof value === 'string') {
    return SENSITIVE_KEY.test(key) ? maskMobile(value) : scrubPII(value);
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return SENSITIVE_KEY.test(key) ? maskMobile(String(value)) : value;
  }
  if (typeof value !== 'object' || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, key, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = scrubDeep(v, k, depth + 1);
  }
  return out;
}
