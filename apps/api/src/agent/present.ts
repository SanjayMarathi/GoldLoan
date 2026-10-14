/**
 * Presentation layer for tool results. The model never formats numbers itself – it copies these
 * ready-made strings, which come from the same server-side maths as the form (no LLM arithmetic).
 */
import { formatGrams, formatGramsFromMg, formatPaise, formatPercent, formatRupees } from '@gold/shared/format';
import type { ApplicationSummaryDto, LoanSchemeDto, PlanQuoteDto, QuoteResponse } from '@gold/shared/types';

export interface PlanDisplay {
  planId: string;
  planName: string;
  repaymentType: 'BULLET' | 'EMI';
  interestRate: string;
  tenureMonths: number;
  appliedLtv: string;
  eligibleLoan: string;
  monthlyEmi: string | null;
  totalInterest: string;
  totalRepayable: string;
}

export interface QuoteDisplay {
  netWeight: string;
  grossWeight: string;
  karat: number;
  ratePerGram24k: string;
  pureGold: string;
  goldValue: string;
  plans: PlanDisplay[];
  disclaimer: string;
}

export interface SchemeDisplay {
  planId: string;
  planName: string;
  repaymentType: 'BULLET' | 'EMI';
  interestRate: string;
  tenureMonths: number;
  maxLtv: string;
}

export interface SummaryDisplay {
  name: string;
  mobileNumber: string;
  netWeight: string;
  grossWeight: string;
  karat: number;
  planName: string;
  interestRate: string;
  tenureMonths: number;
  pureGold: string;
  goldValue: string;
  eligibleLoan: string;
  /** EMI plans only */
  monthlyEmi: string | null;
  totalInterest: string;
  totalRepayable: string;
}

export function planToDisplay(p: PlanQuoteDto): PlanDisplay {
  return {
    planId: p.planId,
    planName: p.planName,
    repaymentType: p.repaymentType,
    interestRate: `${formatPercent(p.annualInterestPercent)} p.a.`,
    tenureMonths: p.tenureMonths,
    appliedLtv: formatPercent(p.appliedLtvPercent),
    eligibleLoan: formatRupees(p.eligibleLoanRupees),
    monthlyEmi: p.indicative.monthlyEmiPaise === null ? null : formatPaise(p.indicative.monthlyEmiPaise),
    totalInterest: formatPaise(p.indicative.totalInterestPaise),
    totalRepayable: formatPaise(p.indicative.totalRepayablePaise),
  };
}

export function quoteToDisplay(q: QuoteResponse): QuoteDisplay {
  return {
    netWeight: formatGrams(q.netWeightGrams),
    grossWeight: formatGrams(q.grossWeightGrams),
    karat: q.karat,
    ratePerGram24k: formatPaise(q.ratePerGram24kPaise),
    pureGold: formatGramsFromMg(q.pureGoldMg),
    goldValue: formatPaise(q.goldValuePaise),
    plans: q.plans.map(planToDisplay),
    disclaimer: q.disclaimer,
  };
}

export function schemesToDisplay(schemes: LoanSchemeDto[]): SchemeDisplay[] {
  return schemes.map((s) => ({
    planId: s.id,
    planName: s.name,
    repaymentType: s.repaymentType,
    interestRate: `${formatPercent(s.annualInterestPercent)} p.a.`,
    tenureMonths: s.tenureMonths,
    maxLtv: formatPercent(s.maxLtvPercent),
  }));
}

export function summaryToDisplay(s: ApplicationSummaryDto): SummaryDisplay {
  return {
    name: s.name,
    mobileNumber: s.mobileNumberMasked,
    netWeight: formatGrams(s.netWeightGrams),
    grossWeight: formatGrams(s.grossWeightGrams),
    karat: s.karat,
    planName: s.planName,
    interestRate: `${formatPercent(s.interestPercent)} p.a.`,
    tenureMonths: s.tenureMonths,
    pureGold: formatGramsFromMg(s.pureGoldMg),
    goldValue: formatPaise(s.goldValuePaise),
    eligibleLoan: formatRupees(s.eligibleLoanRupees),
    monthlyEmi: s.indicative.monthlyEmiPaise === null ? null : formatPaise(s.indicative.monthlyEmiPaise),
    totalInterest: formatPaise(s.indicative.totalInterestPaise),
    totalRepayable: formatPaise(s.indicative.totalRepayablePaise),
  };
}
