import type { RepaymentType } from '@gold/shared/constants';
import type { LoanSchemeDto } from '@gold/shared/types';
import type { PlanTerms } from './QuoteCalculator.ts';

export interface LoanSchemeProps {
  id: string;
  name: string;
  repaymentType: RepaymentType;
  annualInterestBps: number;
  maxLtvBps: number;
  tenureMonths: number;
  active: boolean;
}

/** A loan plan. Immutable; implements PlanTerms so the calculator can use it directly. */
export class LoanScheme implements PlanTerms {
  readonly id: string;
  readonly name: string;
  readonly repaymentType: RepaymentType;
  readonly annualInterestBps: number;
  readonly maxLtvBps: number;
  readonly tenureMonths: number;
  readonly active: boolean;

  constructor(props: LoanSchemeProps) {
    this.id = props.id;
    this.name = props.name;
    this.repaymentType = props.repaymentType;
    this.annualInterestBps = props.annualInterestBps;
    this.maxLtvBps = props.maxLtvBps;
    this.tenureMonths = props.tenureMonths;
    this.active = props.active;
  }

  toDto(): LoanSchemeDto {
    return {
      id: this.id,
      name: this.name,
      repaymentType: this.repaymentType,
      annualInterestPercent: this.annualInterestBps / 100,
      tenureMonths: this.tenureMonths,
      maxLtvPercent: this.maxLtvBps / 100,
    };
  }
}
