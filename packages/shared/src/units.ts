/** Weight helpers. Weights are stored as integer milligrams so no float ever reaches the money maths. */

export const MG_PER_GRAM = 1000;

/** Convert grams (already validated to ≤ 3 decimals) to integer milligrams. */
export function gramsToMg(grams: number): number {
  return Math.round(grams * MG_PER_GRAM);
}

export function mgToGrams(mg: number): number {
  return mg / MG_PER_GRAM;
}

/** True when the value has at most 3 decimal places (i.e. is a whole number of milligrams). */
export function hasAtMostThreeDecimals(grams: number): boolean {
  if (!Number.isFinite(grams)) return false;
  const scaled = grams * MG_PER_GRAM;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}
