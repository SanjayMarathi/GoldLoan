import { formatPaise, formatRupees } from '@gold/shared/format';
import type { PlanQuoteDto } from '@gold/shared/types';

interface PlanCardProps {
  plan: PlanQuoteDto;
  selected: boolean;
  onSelect: () => void;
  badges?: string[];
  dimmed?: boolean;
}

export function PlanCard({ plan, selected, onSelect, badges = [], dimmed = false }: PlanCardProps) {
  const emi = plan.indicative.monthlyEmiPaise;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`plan-card${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
      onClick={onSelect}
    >
      <span className="plan-top">
        <span className="plan-name">{plan.planName}</span>
        <span className="plan-radio" aria-hidden="true" />
      </span>
      {badges.length > 0 && (
        <span className="badges">
          {badges.map((b) => (
            <span key={b} className="badge">
              {b}
            </span>
          ))}
        </span>
      )}
      <span className="plan-loan-label">You can borrow up to</span>
      <span className="plan-loan">{formatRupees(plan.eligibleLoanRupees)}</span>
      <span className="plan-meta">
        <span>
          <b>{plan.annualInterestPercent}%</b> p.a.
        </span>
        <span>
          <b>{plan.tenureMonths}</b> months
        </span>
        <span>
          <b>{plan.appliedLtvPercent}%</b> of value
        </span>
      </span>
      <span className="plan-extra">
        {emi !== null ? (
          <>
            EMI about <b>{formatPaise(emi)}</b>/month
          </>
        ) : (
          <>
            Interest about <b>{formatPaise(plan.indicative.totalInterestPaise)}</b>, paid with principal at the end
          </>
        )}
      </span>
    </button>
  );
}
