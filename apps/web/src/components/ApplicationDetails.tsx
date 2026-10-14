import type { LeadStatus } from '@gold/shared/constants';
import { formatDateTime, formatGrams, formatGramsFromMg, formatPaise, formatPercent, formatRupees } from '@gold/shared/format';
import type { AuditEntryDto, LeadDetailDto } from '@gold/shared/types';
import { STATUS_HELP, STATUS_LABEL } from '../lib/status.ts';
import { Icon } from './Icon.tsx';

type Audience = 'applicant' | 'admin';

const PURITY: Record<number, string> = { 24: '24K · 99.9% pure', 22: '22K · 91.6% pure', 18: '18K · 75% pure' };

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="summary">
      {rows.map(([k, v]) => (
        <div key={k} className="summary-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Everything about one application – used on the success screen, the Track page and the admin drawer. */
export function ApplicationDetails({ lead, audience }: { lead: LeadDetailDto; audience: Audience }) {
  const { indicative } = lead;
  const emi = indicative.monthlyEmiPaise;
  const created = lead.history.find((h) => h.event === 'CREATED');
  const via = created?.channel === 'AGENT' ? 'Loan Assist chat' : created?.channel === 'FORM' ? 'Application form' : '–';

  return (
    <div className="details">
      <div className="details-hero">
        <div className="details-hero-main">
          <span className="eyebrow">Eligible loan</span>
          <b className="details-amount">{formatRupees(lead.eligibleLoanRupees)}</b>
          <span className="muted">
            {lead.planName} · {formatPercent(lead.annualInterestPercent)} p.a. · {lead.tenureMonths} months
          </span>
        </div>
        <div className="details-hero-side">
          <div>
            <span className="eyebrow">{emi !== null ? 'Monthly EMI' : 'Interest at maturity'}</span>
            <b>{formatPaise(emi ?? indicative.totalInterestPaise)}</b>
          </div>
          <div>
            <span className="eyebrow">Total repayable</span>
            <b>{formatPaise(indicative.totalRepayablePaise)}</b>
          </div>
        </div>
      </div>

      <StatusTrack status={lead.status} />
      <p className="status-help">
        <Icon name="info" size={16} />
        <span>{STATUS_HELP[lead.status]}</span>
      </p>

      <div className="details-grid">
        <section aria-labelledby={`${lead.applicationId}-loan`}>
          <h3 id={`${lead.applicationId}-loan`}>Loan offer</h3>
          <Rows
            rows={[
              ['Plan', lead.planName],
              ['Repayment', emi !== null ? `${lead.tenureMonths} equal monthly instalments` : 'Interest + principal at maturity'],
              ['Interest rate', `${formatPercent(lead.annualInterestPercent)} p.a.`],
              ['Tenure', `${lead.tenureMonths} months`],
              ['Loan-to-value applied', formatPercent(lead.appliedLtvPercent)],
              ['Eligible loan', formatRupees(lead.eligibleLoanRupees)],
              [emi !== null ? 'Monthly EMI (approx.)' : 'Interest (approx.)', formatPaise(emi ?? indicative.totalInterestPaise)],
              ...(emi !== null ? ([['Total interest (approx.)', formatPaise(indicative.totalInterestPaise)]] as Array<[string, string]>) : []),
              ['Total repayable (approx.)', formatPaise(indicative.totalRepayablePaise)],
            ]}
          />
        </section>

        <section aria-labelledby={`${lead.applicationId}-gold`}>
          <h3 id={`${lead.applicationId}-gold`}>Gold</h3>
          <Rows
            rows={[
              ['Gross weight', formatGrams(lead.grossWeightGrams)],
              ['Net weight', formatGrams(lead.netWeightGrams)],
              ['Purity', PURITY[lead.karat] ?? `${lead.karat}K`],
              ['Pure gold', formatGramsFromMg(lead.pureGoldMg)],
              ['24K rate used', `${formatPaise(lead.ratePerGram24kPaise)}/g`],
              ['Gold value', formatPaise(lead.goldValuePaise)],
            ]}
          />
        </section>

        <section aria-labelledby={`${lead.applicationId}-who`}>
          <h3 id={`${lead.applicationId}-who`}>Applicant</h3>
          <Rows
            rows={[
              ['Application ID', lead.applicationId],
              ['Name', lead.name],
              ['Mobile', lead.mobileNumber],
              ['Applied via', via],
              ['Filed on', formatDateTime(lead.createdAt)],
            ]}
          />
        </section>

        <section aria-labelledby={`${lead.applicationId}-history`}>
          <h3 id={`${lead.applicationId}-history`}>Status history</h3>
          <Timeline history={lead.history} audience={audience} />
        </section>
      </div>

      <p className="disclaimer">
        <Icon name="shield" size={16} />
        <span>
          Indicative figures, calculated from the plan terms saved with this application. The final loan amount is decided after
          physical appraisal of the gold and is not a promise of approval.
        </span>
      </p>
    </div>
  );
}

const TRACK: LeadStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'];

/** Submitted → Under review → Decision, with the decision shown as Approved or Rejected once it is made. */
function StatusTrack({ status }: { status: LeadStatus }) {
  const reached = status === 'REJECTED' ? 2 : TRACK.indexOf(status);
  const labels = ['Submitted', 'Under review', status === 'REJECTED' ? 'Rejected' : status === 'APPROVED' ? 'Approved' : 'Decision'];
  return (
    <ol className={`status-track${status === 'REJECTED' ? ' rejected' : ''}`} aria-label={`Status: ${STATUS_LABEL[status]}`}>
      {labels.map((label, i) => (
        <li key={label} className={i < reached ? 'done' : i === reached ? 'current' : ''}>
          <span className="st-dot" aria-hidden="true">
            {i < reached || (i === reached && i === 2) ? <Icon name={status === 'REJECTED' && i === 2 ? 'close' : 'check'} size={13} /> : null}
          </span>
          <span className="st-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function Timeline({ history, audience }: { history: AuditEntryDto[]; audience: Audience }) {
  if (history.length === 0) return <p className="muted">No history yet.</p>;
  return (
    <ol className="audit">
      {[...history].reverse().map((e, i) => {
        const to = e.toStatus ? STATUS_LABEL[e.toStatus] : '–';
        const title = e.event === 'CREATED' ? 'Application submitted' : `${e.fromStatus ? STATUS_LABEL[e.fromStatus] : '–'} → ${to}`;
        const by =
          e.event === 'CREATED'
            ? e.channel === 'AGENT'
              ? 'via Loan Assist chat'
              : 'via application form'
            : audience === 'admin'
              ? `by ${e.actor}`
              : 'by our team';
        return (
          <li key={`${e.at}-${i}`}>
            <b>{title}</b>
            <span>
              {formatDateTime(e.at)} · {by}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
