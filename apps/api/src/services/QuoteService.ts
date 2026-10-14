import { QUOTE_DISCLAIMER } from '@gold/shared/constants';
import { gramsToMg } from '@gold/shared/units';
import type { IndicativeRepaymentDto, PlanQuoteDto, QuoteResponse } from '@gold/shared/types';
import type { QuoteRequest } from '@gold/shared/schemas';
import { PlanNotFoundError } from '../lib/errors.ts';
import type { Lead } from '../domain/Lead.ts';
import type { LoanScheme } from '../domain/LoanScheme.ts';
import type { PlanQuote, QuoteCalculator } from '../domain/QuoteCalculator.ts';
import type { LoanSchemeRepository } from '../repositories/interfaces.ts';
import type { GoldRate, GoldRateProvider } from './GoldRate.ts';

export interface QuoteServiceDeps {
  schemes: LoanSchemeRepository;
  goldRate: GoldRateProvider;
  calculator: QuoteCalculator;
}

export function toPlanQuoteDto(q: PlanQuote): PlanQuoteDto {
  return {
    planId: q.planId,
    planName: q.planName,
    repaymentType: q.repaymentType,
    tenureMonths: q.tenureMonths,
    annualInterestPercent: q.annualInterestBps / 100,
    planMaxLtvPercent: q.planMaxLtvBps / 100,
    appliedLtvPercent: q.appliedLtvBps / 100,
    pureGoldMg: q.pureGoldMg,
    goldValuePaise: q.goldValuePaise,
    eligibleLoanRupees: q.eligibleLoanRupees,
    indicative: {
      totalInterestPaise: q.indicative.totalInterestPaise,
      totalRepayablePaise: q.indicative.totalRepayablePaise,
      monthlyEmiPaise: q.indicative.monthlyEmiPaise,
    },
  };
}

/**
 * The single place quotes are produced. Used by POST /quotes, by POST /leads (server-side recompute)
 * and by the AI agent's tools – so the numbers are identical on every path.
 */
export class QuoteService {
  private readonly schemes: LoanSchemeRepository;
  private readonly goldRate: GoldRateProvider;
  private readonly calculator: QuoteCalculator;

  constructor(deps: QuoteServiceDeps) {
    this.schemes = deps.schemes;
    this.goldRate = deps.goldRate;
    this.calculator = deps.calculator;
  }

  listSchemes(): Promise<LoanScheme[]> {
    return this.schemes.listActive();
  }

  /** Pure calculation – no database write. */
  async quote(input: QuoteRequest): Promise<QuoteResponse> {
    const [plans, rate] = await Promise.all([this.schemes.listActive(), this.goldRate.getRate()]);
    const netMg = gramsToMg(input.netWeightGrams);
    const lines = plans.map((plan) => this.calculator.quoteForPlan({ netWeightMg: netMg, karat: input.karat }, plan, rate.ratePerGram24kPaise));
    return {
      netWeightGrams: input.netWeightGrams,
      grossWeightGrams: input.grossWeightGrams,
      karat: input.karat,
      ratePerGram24kPaise: rate.ratePerGram24kPaise,
      pureGoldMg: this.calculator.pureGoldMg(netMg, input.karat),
      goldValuePaise: this.calculator.goldValuePaise(netMg, input.karat, rate.ratePerGram24kPaise),
      plans: lines.map(toPlanQuoteDto),
      disclaimer: QUOTE_DISCLAIMER,
    };
  }

  /** Quote for one specific plan (throws 404 PLAN_NOT_FOUND). Used when a lead is created. */
  async quoteForPlan(
    input: { netWeightGrams: number; karat: number },
    planId: string,
  ): Promise<{ scheme: LoanScheme; quote: PlanQuote; rate: GoldRate }> {
    const [scheme, rate] = await Promise.all([this.schemes.findActiveById(planId), this.goldRate.getRate()]);
    if (!scheme) throw new PlanNotFoundError(planId);
    const quote = this.calculator.quoteForPlan(
      { netWeightMg: gramsToMg(input.netWeightGrams), karat: input.karat },
      scheme,
      rate.ratePerGram24kPaise,
    );
    return { scheme, quote, rate };
  }

  currentRate(): Promise<GoldRate> {
    return this.goldRate.getRate();
  }

  /** EMI / interest for a stored application, from the plan terms it was filed with (same maths as the quote). */
  indicativeFor(lead: Lead): IndicativeRepaymentDto {
    const r = this.calculator.indicativeRepayment(lead.eligibleLoanRupees, {
      id: lead.planId,
      name: lead.planName,
      repaymentType: lead.repaymentType,
      annualInterestBps: lead.annualInterestBps,
      maxLtvBps: lead.appliedLtvBps,
      tenureMonths: lead.tenureMonths,
    });
    return { totalInterestPaise: r.totalInterestPaise, totalRepayablePaise: r.totalRepayablePaise, monthlyEmiPaise: r.monthlyEmiPaise };
  }
}
