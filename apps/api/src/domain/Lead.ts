import { STATUS_TRANSITIONS } from '@gold/shared/constants';
import type { LeadStatus, RepaymentType } from '@gold/shared/constants';
import { maskMobile } from '@gold/shared/mask';
import { mgToGrams } from '@gold/shared/units';
import type { LeadRecordDto } from '@gold/shared/types';

export interface LeadProps {
  applicationId: string;
  name: string;
  /** The real number. Only ever leaves the server masked (see toDto). */
  mobileNumber: string;
  grossWeightMg: number;
  netWeightMg: number;
  karat: number;
  planId: string;
  planName: string;
  /** Plan terms as they were when the application was filed (a snapshot – later plan edits never change an offer) */
  repaymentType: RepaymentType;
  annualInterestBps: number;
  tenureMonths: number;
  appliedLtvBps: number;
  ratePerGram24kPaise: number;
  pureGoldMg: number;
  goldValuePaise: number;
  eligibleLoanRupees: number;
  status: LeadStatus;
  createdAt: Date;
}

/** A stored application. The mobile number is masked by construction in toDto(). */
export class Lead {
  readonly applicationId: string;
  readonly name: string;
  readonly mobileNumber: string;
  readonly grossWeightMg: number;
  readonly netWeightMg: number;
  readonly karat: number;
  readonly planId: string;
  readonly planName: string;
  readonly repaymentType: RepaymentType;
  readonly annualInterestBps: number;
  readonly tenureMonths: number;
  readonly appliedLtvBps: number;
  readonly ratePerGram24kPaise: number;
  readonly pureGoldMg: number;
  readonly goldValuePaise: number;
  readonly eligibleLoanRupees: number;
  readonly status: LeadStatus;
  readonly createdAt: Date;

  constructor(props: LeadProps) {
    this.applicationId = props.applicationId;
    this.name = props.name;
    this.mobileNumber = props.mobileNumber;
    this.grossWeightMg = props.grossWeightMg;
    this.netWeightMg = props.netWeightMg;
    this.karat = props.karat;
    this.planId = props.planId;
    this.planName = props.planName;
    this.repaymentType = props.repaymentType;
    this.annualInterestBps = props.annualInterestBps;
    this.tenureMonths = props.tenureMonths;
    this.appliedLtvBps = props.appliedLtvBps;
    this.ratePerGram24kPaise = props.ratePerGram24kPaise;
    this.pureGoldMg = props.pureGoldMg;
    this.goldValuePaise = props.goldValuePaise;
    this.eligibleLoanRupees = props.eligibleLoanRupees;
    this.status = props.status;
    this.createdAt = props.createdAt;
  }

  canTransitionTo(next: LeadStatus): boolean {
    return STATUS_TRANSITIONS[this.status].includes(next);
  }

  withStatus(status: LeadStatus): Lead {
    return new Lead({ ...this.toProps(), status });
  }

  toProps(): LeadProps {
    return {
      applicationId: this.applicationId,
      name: this.name,
      mobileNumber: this.mobileNumber,
      grossWeightMg: this.grossWeightMg,
      netWeightMg: this.netWeightMg,
      karat: this.karat,
      planId: this.planId,
      planName: this.planName,
      repaymentType: this.repaymentType,
      annualInterestBps: this.annualInterestBps,
      tenureMonths: this.tenureMonths,
      appliedLtvBps: this.appliedLtvBps,
      ratePerGram24kPaise: this.ratePerGram24kPaise,
      pureGoldMg: this.pureGoldMg,
      goldValuePaise: this.goldValuePaise,
      eligibleLoanRupees: this.eligibleLoanRupees,
      status: this.status,
      createdAt: this.createdAt,
    };
  }

  /** The only way a lead is serialised for a client: mobile masked. */
  toDto(): LeadRecordDto {
    return {
      applicationId: this.applicationId,
      name: this.name,
      mobileNumber: maskMobile(this.mobileNumber),
      netWeightGrams: mgToGrams(this.netWeightMg),
      grossWeightGrams: mgToGrams(this.grossWeightMg),
      karat: this.karat,
      planId: this.planId,
      planName: this.planName,
      repaymentType: this.repaymentType,
      annualInterestPercent: this.annualInterestBps / 100,
      tenureMonths: this.tenureMonths,
      appliedLtvPercent: this.appliedLtvBps / 100,
      ratePerGram24kPaise: this.ratePerGram24kPaise,
      pureGoldMg: this.pureGoldMg,
      goldValuePaise: this.goldValuePaise,
      eligibleLoanRupees: this.eligibleLoanRupees,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
