import { formatGramsFromMg, formatPaise, formatRupees } from '@gold/shared/format';
import type { QuoteState } from '../hooks/useQuote.ts';
import { Icon } from './Icon.tsx';
import { PlanCard } from './PlanCard.tsx';

interface PlanStepProps {
  quote: QuoteState;
  planId: string | null;
  onSelect: (planId: string) => void;
  onReview: () => void;
}

/** Section 2: the live quote as selectable plan cards. Updates while the applicant types in section 1. */
export function PlanStep({ quote, planId, onSelect, onReview }: PlanStepProps) {
  const data = quote.status === 'idle' ? undefined : quote.data;
  const loading = quote.status === 'loading';

  if (!data) {
    if (quote.status === 'error') {
      return (
        <div className="banner error" role="alert">
          <Icon name="alert" size={18} />
          <span>{quote.message}</span>
        </div>
      );
    }
    if (quote.status === 'loading') {
      return (
        <div className="plans" aria-busy="true">
          <div className="plan-card skeleton" />
          <div className="plan-card skeleton" />
        </div>
      );
    }
    return (
      <div className="section-empty">
        <Icon name="bolt" size={18} />
        <span>Enter the gross and net weight and the purity above – both plans appear here instantly.</span>
      </div>
    );
  }

  const maxLoan = Math.max(...data.plans.map((p) => p.eligibleLoanRupees));
  const minRate = Math.min(...data.plans.map((p) => p.annualInterestPercent));
  const badgesFor = (loan: number, rate: number): string[] => {
    const out: string[] = [];
    if (data.plans.length > 1 && loan === maxLoan) out.push('Highest loan');
    if (data.plans.length > 1 && rate === minRate) out.push('Lowest interest');
    return out;
  };
  const selected = data.plans.find((p) => p.planId === planId) ?? null;

  return (
    <div className="form">
      <p className="step-intro">
        <b>{formatGramsFromMg(data.pureGoldMg)}</b> of pure gold, worth <b>{formatPaise(data.goldValuePaise)}</b> at ₹
        {(data.ratePerGram24kPaise / 100).toLocaleString('en-IN')}/g (24K). Choose how you’d like to repay:
      </p>

      <div className="plans" role="radiogroup" aria-label="Loan plans" aria-busy={loading}>
        {data.plans.map((plan) => (
          <PlanCard
            key={plan.planId}
            plan={plan}
            selected={planId === plan.planId}
            onSelect={() => onSelect(plan.planId)}
            badges={badgesFor(plan.eligibleLoanRupees, plan.annualInterestPercent)}
            dimmed={loading}
          />
        ))}
      </div>

      <p className="disclaimer">
        <Icon name="info" size={16} />
        <span>{data.disclaimer}</span>
      </p>

      {selected && (
        <div className="selected-bar" aria-live="polite">
          <span>
            <b>{selected.planName}</b> selected · {formatRupees(selected.eligibleLoanRupees)}
          </span>
          <button type="button" className="btn btn-primary btn-small" onClick={onReview}>
            Review below
          </button>
        </div>
      )}
    </div>
  );
}
