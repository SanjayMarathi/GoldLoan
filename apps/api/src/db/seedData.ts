import { PLAN_BULLET_ID, PLAN_EMI_ID } from '@gold/shared/constants';
import type { LoanSchemeProps } from '../domain/LoanScheme.ts';

/** The two plans from the assignment. Used by the SQL seed script AND the in-memory repository. */
export const SEED_SCHEMES: ReadonlyArray<LoanSchemeProps & { sortOrder: number }> = [
  {
    id: PLAN_BULLET_ID,
    name: 'Bullet Repayment',
    repaymentType: 'BULLET',
    annualInterestBps: 1200, // 12.0% p.a.
    maxLtvBps: 7000, // 70%
    tenureMonths: 12,
    active: true,
    sortOrder: 1,
  },
  {
    id: PLAN_EMI_ID,
    name: 'Monthly EMI',
    repaymentType: 'EMI',
    annualInterestBps: 1050, // 10.5% p.a.
    maxLtvBps: 7500, // 75%
    tenureMonths: 12,
    active: true,
    sortOrder: 2,
  },
];
