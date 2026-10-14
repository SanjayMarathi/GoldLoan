/**
 * QuoteCalculator – the ONLY place gold-loan money maths lives.
 *
 * Rules
 *  • Weights are integer milligrams, money is integer paise / whole rupees. No floats anywhere.
 *  • Everything is BigInt, and each result is computed with ONE division at the end, so there is
 *    no intermediate rounding: pureGold × rate × LTV is exact, then floored once.
 *  • The loan is floored to whole rupees and never exceeds the 75% cap (min(plan LTV, cap)).
 *
 *      pureGoldMg    = netMg × karat / 24                         (display value, rounded to nearest mg)
 *      goldValuePaise= floor(netMg × karat × ratePaisePerGram / (24 × 1000))
 *      loanRupees    = floor(netMg × karat × ratePaise × ltvBps / (24 × 1000 × 10 000 × 100))
 */
import { MAX_LTV_BPS } from '@gold/shared/constants';
import type { RepaymentType } from '@gold/shared/constants';

const SCALE = 10n ** 18n;

export interface PlanTerms {
  readonly id: string;
  readonly name: string;
  readonly repaymentType: RepaymentType;
  readonly annualInterestBps: number;
  readonly maxLtvBps: number;
  readonly tenureMonths: number;
}

export interface GoldInput {
  readonly netWeightMg: number;
  readonly karat: number;
}

export interface IndicativeRepayment {
  readonly totalInterestPaise: number;
  readonly totalRepayablePaise: number;
  readonly monthlyEmiPaise: number | null;
}

export interface PlanQuote {
  readonly planId: string;
  readonly planName: string;
  readonly repaymentType: RepaymentType;
  readonly tenureMonths: number;
  readonly annualInterestBps: number;
  readonly planMaxLtvBps: number;
  readonly appliedLtvBps: number;
  readonly pureGoldMg: number;
  readonly goldValuePaise: number;
  readonly eligibleLoanRupees: number;
  readonly indicative: IndicativeRepayment;
}

/** Round-half-up integer division for non-negative BigInts. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

export class QuoteCalculator {
  private readonly ltvCapBps: number;

  constructor(ltvCapBps: number = MAX_LTV_BPS) {
    if (!Number.isInteger(ltvCapBps) || ltvCapBps <= 0 || ltvCapBps > MAX_LTV_BPS) {
      throw new RangeError(`LTV cap must be an integer between 1 and ${MAX_LTV_BPS} bps`);
    }
    this.ltvCapBps = ltvCapBps;
  }

  /** The LTV that is actually applied: never above the cap, whatever the plan says. */
  appliedLtvBps(planMaxLtvBps: number): number {
    return Math.min(planMaxLtvBps, this.ltvCapBps);
  }

  /** netMg × karat / 24, rounded half-up to the nearest milligram (display only). */
  pureGoldMg(netWeightMg: number, karat: number): number {
    this.assertInputs(netWeightMg, karat);
    const numerator = BigInt(netWeightMg) * BigInt(karat);
    return Number(roundDiv(numerator, 24n));
  }

  /** Value of the pure gold in paise (floored). */
  goldValuePaise(netWeightMg: number, karat: number, ratePerGram24kPaise: number | bigint): number {
    this.assertInputs(netWeightMg, karat);
    const numerator = BigInt(netWeightMg) * BigInt(karat) * BigInt(ratePerGram24kPaise);
    return Number(numerator / (24n * 1000n));
  }

  /** Loan in whole rupees: floor(goldValue × min(planLtv, cap)), computed exactly in one division. */
  eligibleLoanRupees(
    netWeightMg: number,
    karat: number,
    ratePerGram24kPaise: number | bigint,
    planMaxLtvBps: number,
  ): number {
    this.assertInputs(netWeightMg, karat);
    const ltv = BigInt(this.appliedLtvBps(planMaxLtvBps));
    const numerator = BigInt(netWeightMg) * BigInt(karat) * BigInt(ratePerGram24kPaise) * ltv;
    const denominator = 24n * 1000n * 10_000n * 100n;
    return Number(numerator / denominator);
  }

  /** Full quote for one plan. */
  quoteForPlan(input: GoldInput, plan: PlanTerms, ratePerGram24kPaise: number | bigint): PlanQuote {
    const { netWeightMg, karat } = input;
    const loan = this.eligibleLoanRupees(netWeightMg, karat, ratePerGram24kPaise, plan.maxLtvBps);
    return {
      planId: plan.id,
      planName: plan.name,
      repaymentType: plan.repaymentType,
      tenureMonths: plan.tenureMonths,
      annualInterestBps: plan.annualInterestBps,
      planMaxLtvBps: plan.maxLtvBps,
      appliedLtvBps: this.appliedLtvBps(plan.maxLtvBps),
      pureGoldMg: this.pureGoldMg(netWeightMg, karat),
      goldValuePaise: this.goldValuePaise(netWeightMg, karat, ratePerGram24kPaise),
      eligibleLoanRupees: loan,
      indicative: this.indicativeRepayment(loan, plan),
    };
  }

  /** Indicative repayment figures (simple interest for BULLET, reducing-balance EMI for EMI). */
  indicativeRepayment(loanRupees: number, plan: PlanTerms): IndicativeRepayment {
    const principal = BigInt(loanRupees) * 100n;
    if (principal === 0n) return { totalInterestPaise: 0, totalRepayablePaise: 0, monthlyEmiPaise: plan.repaymentType === 'EMI' ? 0 : null };

    if (plan.repaymentType === 'BULLET') {
      const interest = roundDiv(principal * BigInt(plan.annualInterestBps) * BigInt(plan.tenureMonths), 10_000n * 12n);
      return {
        totalInterestPaise: Number(interest),
        totalRepayablePaise: Number(principal + interest),
        monthlyEmiPaise: null,
      };
    }

    const emi = this.monthlyEmiPaise(principal, plan.annualInterestBps, plan.tenureMonths);
    const total = emi * BigInt(plan.tenureMonths);
    return {
      totalInterestPaise: Number(total - principal),
      totalRepayablePaise: Number(total),
      monthlyEmiPaise: Number(emi),
    };
  }

  /** EMI = P·r·(1+r)^n / ((1+r)^n − 1), in 18-digit fixed point, rounded half-up to the paisa. */
  private monthlyEmiPaise(principal: bigint, annualBps: number, months: number): bigint {
    if (annualBps === 0) return roundDiv(principal, BigInt(months));
    const r = (BigInt(annualBps) * SCALE) / (12n * 10_000n);
    const onePlusR = SCALE + r;
    let pow = SCALE;
    for (let i = 0; i < months; i++) pow = (pow * onePlusR) / SCALE;
    const numerator = principal * r * pow;
    const denominator = SCALE * (pow - SCALE);
    return roundDiv(numerator, denominator);
  }

  private assertInputs(netWeightMg: number, karat: number): void {
    if (!Number.isSafeInteger(netWeightMg) || netWeightMg <= 0) {
      throw new RangeError('netWeightMg must be a positive integer number of milligrams');
    }
    if (!Number.isSafeInteger(karat) || karat <= 0 || karat > 24) {
      throw new RangeError('karat must be a positive integer up to 24');
    }
  }
}
