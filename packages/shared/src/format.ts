/** Display formatting. Integer arithmetic only; Indian digit grouping (₹2,88,750). */

/** "1234567" → "12,34,567" */
export function groupIndian(digits: string): string {
  const negative = digits.startsWith('-');
  const s = negative ? digits.slice(1) : digits;
  const sign = negative ? '-' : '';
  if (s.length <= 3) return sign + s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) groups.unshift(rest);
  return `${sign}${groups.join(',')},${last3}`;
}

/** Whole rupees → "₹2,16,562" */
export function formatRupees(rupees: number | bigint): string {
  const n = typeof rupees === 'bigint' ? rupees : BigInt(Math.trunc(rupees));
  return `₹${groupIndian(n.toString())}`;
}

/** Paise → "₹2,88,750" (whole) or "₹64,166.67" (fractional). */
export function formatPaise(paise: number | bigint): string {
  const p = typeof paise === 'bigint' ? paise : BigInt(Math.trunc(paise));
  const rupees = p / 100n;
  const rem = p % 100n;
  const head = `₹${groupIndian(rupees.toString())}`;
  return rem === 0n ? head : `${head}.${rem.toString().padStart(2, '0')}`;
}

/** Milligrams → "41.25 g", "7.5 g", "9.167 g" */
export function formatGramsFromMg(mg: number): string {
  const m = Math.round(mg);
  const whole = Math.trunc(m / 1000);
  const frac = Math.abs(m % 1000);
  let s = String(whole);
  if (frac !== 0) s += `.${String(frac).padStart(3, '0').replace(/0+$/, '')}`;
  return `${s} g`;
}

/** Grams as entered by a user → "45 g" */
export function formatGrams(grams: number): string {
  return formatGramsFromMg(Math.round(grams * 1000));
}

export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/** ISO date → "3 Oct" (India time) */
export function formatDayMonth(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d);
}

/** ISO date → "3 Oct 2026, 3:30 pm" (India time) */
export function formatDateTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(d);
}
