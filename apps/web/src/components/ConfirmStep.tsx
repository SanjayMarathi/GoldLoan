import { formatGramsFromMg, formatPaise, formatPercent, formatRupees } from '@gold/shared/format';
import type { PlanQuoteDto, QuoteResponse } from '@gold/shared/types';
import { toWeight } from '../lib/details.ts';
import type { DetailsErrors, DetailsField, DetailsValues } from '../lib/details.ts';
import { Icon } from './Icon.tsx';

export type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'duplicate'; message: string }
  | { status: 'error'; message: string };

const FIELD_LABEL: Record<DetailsField, string> = {
  name: 'Full name',
  mobileNumber: 'Mobile number',
  grossWeightGrams: 'Gross weight',
  netWeightGrams: 'Net weight',
  karat: 'Purity',
};

interface ConfirmStepProps {
  values: DetailsValues;
  errors: DetailsErrors;
  quote: QuoteResponse | undefined;
  plan: PlanQuoteDto | null;
  submit: SubmitState;
  onFixField: (field: DetailsField) => void;
  onChoosePlan: () => void;
  onSubmit: () => void;
}

/** Section 3: the full summary – every figure the applicant is agreeing to – and the submit button. */
export function ConfirmStep({ values, errors, quote, plan, submit, onFixField, onChoosePlan, onSubmit }: ConfirmStepProps) {
  const missing = Object.entries(errors) as Array<[DetailsField, string]>;

  if (missing.length > 0 || !plan || !quote) {
    return (
      <div className="section-empty checklist">
        <p>To see your summary and submit, please:</p>
        <ul>
          {missing.map(([field, message]) => (
            <li key={field}>
              <button type="button" className="btn-link" onClick={() => onFixField(field)}>
                {FIELD_LABEL[field]}
              </button>{' '}
              – {message}
            </li>
          ))}
          {!plan && (
            <li>
              <button type="button" className="btn-link" onClick={onChoosePlan}>
                Choose a plan
              </button>{' '}
              – tap one of the plan cards above
            </li>
          )}
        </ul>
      </div>
    );
  }

  const busy = submit.status === 'submitting';
  const emi = plan.indicative.monthlyEmiPaise;
  const rows: Array<[string, string]> = [
    ['Name', values.name.trim()],
    ['Mobile', `+91 ${values.mobile}`],
    ['Gold', `${toWeight(values.net)} g net · ${toWeight(values.gross)} g gross · ${values.karat}K`],
    ['Pure gold', formatGramsFromMg(quote.pureGoldMg)],
    ['Gold value', formatPaise(quote.goldValuePaise)],
    ['Plan', plan.planName],
    ['Interest rate', `${formatPercent(plan.annualInterestPercent)} p.a.`],
    ['Tenure', `${plan.tenureMonths} months`],
    ['Loan-to-value applied', formatPercent(plan.appliedLtvPercent)],
    [emi !== null ? 'Monthly EMI (approx.)' : 'Interest at maturity (approx.)', formatPaise(emi ?? plan.indicative.totalInterestPaise)],
    ...(emi !== null ? ([['Total interest (approx.)', formatPaise(plan.indicative.totalInterestPaise)]] as Array<[string, string]>) : []),
    ['Total repayable (approx.)', formatPaise(plan.indicative.totalRepayablePaise)],
  ];

  return (
    <div className="form">
      <dl className="summary">
        {rows.map(([k, v]) => (
          <div key={k} className="summary-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="summary-row total">
          <dt>Eligible loan</dt>
          <dd>{formatRupees(plan.eligibleLoanRupees)}</dd>
        </div>
      </dl>

      <p className="disclaimer">
        <Icon name="shield" size={16} />
        <span>{quote.disclaimer} The amount is calculated again on our server when you submit.</span>
      </p>

      {submit.status === 'duplicate' && (
        <div className="banner warn" role="alert">
          <Icon name="info" size={18} />
          <span>{submit.message}</span>
        </div>
      )}
      {submit.status === 'error' && (
        <div className="banner error" role="alert">
          <Icon name="alert" size={18} />
          <span>{submit.message}</span>
        </div>
      )}

      <button type="button" className="btn btn-primary btn-block" onClick={onSubmit} disabled={busy || submit.status === 'duplicate'}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" /> Submitting…
          </>
        ) : submit.status === 'error' ? (
          'Try again'
        ) : (
          'Submit application'
        )}
      </button>
    </div>
  );
}
