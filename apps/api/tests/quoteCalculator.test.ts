import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QuoteCalculator } from '../src/domain/QuoteCalculator.ts';
import type { PlanTerms } from '../src/domain/QuoteCalculator.ts';

const RATE = 700_000; // ₹7,000 per gram of 24K, in paise

const BULLET: PlanTerms = {
  id: 'PLAN_BULLET_01',
  name: 'Bullet Repayment',
  repaymentType: 'BULLET',
  annualInterestBps: 1200,
  maxLtvBps: 7000,
  tenureMonths: 12,
};
const EMI: PlanTerms = {
  id: 'PLAN_EMI_01',
  name: 'Monthly EMI',
  repaymentType: 'EMI',
  annualInterestBps: 1050,
  maxLtvBps: 7500,
  tenureMonths: 12,
};

const calc = new QuoteCalculator();

describe('QuoteCalculator – PDF test cases 1-3', () => {
  it('case 1: 45 g net · 22K · EMI → pure 41.25 g · value ₹2,88,750 · loan ₹2,16,562', () => {
    const q = calc.quoteForPlan({ netWeightMg: 45_000, karat: 22 }, EMI, RATE);
    assert.equal(q.pureGoldMg, 41_250);
    assert.equal(q.goldValuePaise, 28_875_000); // ₹2,88,750
    assert.equal(q.eligibleLoanRupees, 216_562); // 216,562.5 floored, NOT rounded to 216,563
    assert.equal(q.appliedLtvBps, 7500);
  });

  it('case 2: 45 g net · 22K · Bullet → value ₹2,88,750 · loan ₹2,02,125 (70% LTV)', () => {
    const q = calc.quoteForPlan({ netWeightMg: 45_000, karat: 22 }, BULLET, RATE);
    assert.equal(q.goldValuePaise, 28_875_000);
    assert.equal(q.eligibleLoanRupees, 202_125);
    assert.equal(q.appliedLtvBps, 7000);
  });

  it('case 3: 10 g net · 18K · EMI → pure 7.5 g · value ₹52,500 · loan ₹39,375', () => {
    const q = calc.quoteForPlan({ netWeightMg: 10_000, karat: 18 }, EMI, RATE);
    assert.equal(q.pureGoldMg, 7_500);
    assert.equal(q.goldValuePaise, 5_250_000);
    assert.equal(q.eligibleLoanRupees, 39_375);
  });
});

describe('QuoteCalculator – rounding and exactness', () => {
  it('floors the loan to whole rupees (never rounds up)', () => {
    // 216,562.5 → 216,562
    assert.equal(calc.eligibleLoanRupees(45_000, 22, RATE, 7500), 216_562);
  });

  it('handles fractional paise in the gold value by flooring', () => {
    // 10 g · 22K = 64,166.666… rupees → 6,416,666 paise
    assert.equal(calc.goldValuePaise(10_000, 22, RATE), 6_416_666);
    assert.equal(calc.pureGoldMg(10_000, 22), 9_167); // 9166.67 mg rounded to nearest mg
  });

  it('is exact for milligram weights that would break float maths', () => {
    // 10.001 g of 24K = 10001 mg → 10.001 × 7000 = ₹70,007 exactly
    assert.equal(calc.goldValuePaise(10_001, 24, RATE), 7_000_700);
    // loan at 75%: 52,505.25 → 52,505
    assert.equal(calc.eligibleLoanRupees(10_001, 24, RATE, 7500), 52_505);
  });

  it('handles the 1000 g maximum', () => {
    assert.equal(calc.goldValuePaise(1_000_000, 24, RATE), 700_000_000); // ₹70,00,000
    assert.equal(calc.eligibleLoanRupees(1_000_000, 24, RATE, 7500), 5_250_000);
  });
});

describe('QuoteCalculator – LTV is enforced on the server', () => {
  it('never lends more than 75% even if a plan says 90%', () => {
    assert.equal(calc.appliedLtvBps(9000), 7500);
    assert.equal(calc.eligibleLoanRupees(45_000, 22, RATE, 9000), 216_562);
  });

  it('uses the lower LTV when the plan is below the cap', () => {
    assert.equal(calc.appliedLtvBps(7000), 7000);
  });

  it('property: loan ≤ 75% of value, and is the exact floor, for many inputs', () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 2000; i++) {
      const mg = (next() % 999_999) + 1;
      const karat = [18, 22, 24][next() % 3]!;
      const ltv = [5000, 7000, 7500, 8000][next() % 4]!;
      const value = BigInt(calc.goldValuePaise(mg, karat, RATE));
      const loan = BigInt(calc.eligibleLoanRupees(mg, karat, RATE, ltv));
      const cap = BigInt(Math.min(ltv, 7500));
      // exact rational value (not floored) × ltv
      const exactNumerator = BigInt(mg) * BigInt(karat) * BigInt(RATE) * cap;
      const denominator = 24n * 1000n * 10_000n * 100n;
      assert.ok(loan * 100n <= value * 75n, `loan above 75% for ${mg}mg ${karat}K`);
      assert.ok(loan * denominator <= exactNumerator, 'loan above exact value');
      assert.ok((loan + 1n) * denominator > exactNumerator, 'loan is not the floor');
    }
  });

  it('rejects an LTV cap above 75%', () => {
    assert.throws(() => new QuoteCalculator(8000), RangeError);
  });
});

describe('QuoteCalculator – indicative repayment', () => {
  it('bullet: simple interest, principal + interest at maturity', () => {
    const q = calc.quoteForPlan({ netWeightMg: 45_000, karat: 22 }, BULLET, RATE);
    // ₹2,02,125 × 12% = ₹24,255
    assert.equal(q.indicative.totalInterestPaise, 2_425_500);
    assert.equal(q.indicative.totalRepayablePaise, 20_212_500 + 2_425_500);
    assert.equal(q.indicative.monthlyEmiPaise, null);
  });

  it('EMI: matches the floating-point formula to within a paisa', () => {
    const q = calc.quoteForPlan({ netWeightMg: 45_000, karat: 22 }, EMI, RATE);
    const p = q.eligibleLoanRupees * 100;
    const r = 0.105 / 12;
    const n = 12;
    const expected = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    assert.ok(Math.abs((q.indicative.monthlyEmiPaise as number) - expected) <= 1, `emi ${q.indicative.monthlyEmiPaise} vs ${expected}`);
    assert.equal(q.indicative.totalRepayablePaise, (q.indicative.monthlyEmiPaise as number) * 12);
  });
});

describe('QuoteCalculator – defensive checks', () => {
  it('rejects non-integer or non-positive inputs', () => {
    assert.throws(() => calc.pureGoldMg(45.5, 22), RangeError);
    assert.throws(() => calc.pureGoldMg(0, 22), RangeError);
    assert.throws(() => calc.pureGoldMg(1000, 0), RangeError);
    assert.throws(() => calc.pureGoldMg(1000, 25), RangeError);
  });
});
