import { useMemo, useRef, useState } from 'react';
import { DUPLICATE_WINDOW_MS } from '@gold/shared/constants';
import { formatDayMonth } from '@gold/shared/format';
import type { CreateLeadResponse } from '@gold/shared/types';
import { ApiError, api } from '../api/client.ts';
import { useQuote } from '../hooks/useQuote.ts';
import type { HistoryEntry } from '../hooks/useHistory.ts';
import { EMPTY_DETAILS, toNumberOrNull, toPayload, validateDetails } from '../lib/details.ts';
import type { DetailsErrors, DetailsField, DetailsValues } from '../lib/details.ts';
import { newId } from '../lib/storage.ts';
import { ConfirmStep } from './ConfirmStep.tsx';
import type { SubmitState } from './ConfirmStep.tsx';
import { DetailsStep } from './DetailsStep.tsx';
import { PlanStep } from './PlanStep.tsx';
import { Stepper } from './Stepper.tsx';
import { SuccessScreen } from './SuccessScreen.tsx';

interface ApplyPageProps {
  onFiled: (entry: HistoryEntry) => void;
  onTrack: (applicationId: string) => void;
  onRestart: () => void;
}

const ALL_FIELDS: DetailsField[] = ['name', 'mobileNumber', 'grossWeightGrams', 'netWeightGrams', 'karat'];
const INPUT_ID: Record<DetailsField, string> = { name: 'name', mobileNumber: 'mobile', grossWeightGrams: 'gross', netWeightGrams: 'net', karat: 'karat-label' };
const SECTION_ID = { 1: 'sec-details', 2: 'sec-plan', 3: 'sec-review' } as const;

function scrollToId(id: string): void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/**
 * The application as ONE scrollable page in three numbered sections:
 *   1 Your gold & details → 2 Choose plan (live quote, updates as you type) → 3 Review & submit.
 * The sticky progress bar shows what is complete and jumps to any section.
 */
export function ApplyPage({ onFiled, onTrack, onRestart }: ApplyPageProps) {
  const [values, setValues] = useState<DetailsValues>(EMPTY_DETAILS);
  const [touched, setTouched] = useState<Partial<Record<DetailsField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<DetailsErrors>({});
  const [planId, setPlanId] = useState<string | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });
  const [done, setDone] = useState<CreateLeadResponse | null>(null);

  // One Idempotency-Key per distinct payload: a retry after a timeout can never create a second application.
  const keyRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const clientErrors = useMemo(() => validateDetails(values), [values]);
  const errors: DetailsErrors = { ...clientErrors, ...serverErrors };
  const detailsOk = Object.keys(errors).length === 0;

  const quote = useQuote({ net: toNumberOrNull(values.net), gross: toNumberOrNull(values.gross), karat: values.karat });
  const quoteData = quote.status === 'idle' ? undefined : quote.data;
  const selectedPlan = quoteData?.plans.find((p) => p.planId === planId) ?? null;
  const current: 1 | 2 | 3 = !detailsOk ? 1 : !selectedPlan ? 2 : 3;

  const change = (patch: Partial<DetailsValues>): void => {
    setValues((v) => ({ ...v, ...patch }));
    setServerErrors({});
    setSubmit({ status: 'idle' });
  };
  const touch = (field: DetailsField): void => setTouched((t) => ({ ...t, [field]: true }));
  const touchAll = (): void => setTouched(Object.fromEntries(ALL_FIELDS.map((f) => [f, true])));

  const fixField = (field: DetailsField): void => {
    touchAll();
    const el = document.getElementById(INPUT_ID[field]);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const submitApplication = async (): Promise<void> => {
    touchAll();
    const firstError = ALL_FIELDS.find((f) => errors[f]);
    if (firstError) return fixField(firstError);
    if (!selectedPlan) return scrollToId(SECTION_ID[2]);

    const payload = toPayload(values, selectedPlan.planId);
    const fingerprint = JSON.stringify(payload);
    if (!keyRef.current || keyRef.current.fingerprint !== fingerprint) keyRef.current = { key: newId(), fingerprint };

    setSubmit({ status: 'submitting' });
    try {
      const response = await api.createLead(payload, keyRef.current.key);
      onFiled({
        applicationId: response.applicationId,
        loanRupees: response.lead.eligibleLoanRupees,
        planName: response.lead.planName,
        at: response.createdAt,
        via: 'form',
      });
      setDone(response);
      setSubmit({ status: 'idle' });
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setSubmit({ status: 'error', message: 'Something went wrong. Please try again.' });
        return;
      }
      if (error.status === 409 && error.code === 'DUPLICATE_APPLICATION') {
        const id = String(error.details?.applicationId ?? '');
        const appliedAt = typeof error.details?.appliedAt === 'string' ? error.details.appliedAt : null;
        const when = appliedAt ? formatDayMonth(appliedAt) : 'recently';
        const again = appliedAt ? ` You can apply again after ${formatDayMonth(new Date(new Date(appliedAt).getTime() + DUPLICATE_WINDOW_MS))}.` : '';
        setSubmit({ status: 'duplicate', message: `You already applied on ${when}, application ${id}.${again} Use Track to see its status.` });
      } else if (error.status === 400 && error.fields.length > 0) {
        const mapped: DetailsErrors = {};
        for (const f of error.fields) if ((ALL_FIELDS as string[]).includes(f.field)) mapped[f.field as DetailsField] = f.message;
        setServerErrors(mapped);
        setSubmit({ status: 'idle' });
        const first = ALL_FIELDS.find((f) => mapped[f]);
        if (first) fixField(first);
      } else if (error.status === 404 && error.code === 'PLAN_NOT_FOUND') {
        setPlanId(null);
        setSubmit({ status: 'error', message: 'That plan is no longer available. Please choose another plan.' });
        scrollToId(SECTION_ID[2]);
      } else if (error.status === 429) {
        setSubmit({ status: 'error', message: 'Too many attempts. Please wait a minute and try again.' });
      } else {
        setSubmit({ status: 'error', message: error.message });
      }
    }
  };

  if (done) {
    return (
      <section className="card">
        <Stepper step={4} />
        <SuccessScreen response={done} onNew={onRestart} onTrack={() => onTrack(done.applicationId)} />
      </section>
    );
  }

  return (
    <section className="card apply" aria-labelledby="apply-title">
      <div className="apply-progress">
        <Stepper step={current} done={[detailsOk, Boolean(selectedPlan), false]} onJump={(n) => scrollToId(SECTION_ID[n])} />
      </div>

      <header className="card-head">
        <h1 id="apply-title">Get your gold loan estimate</h1>
        <p className="muted">Everything is on this page – your loan updates live as you type.</p>
      </header>

      <section id={SECTION_ID[1]} className="apply-section" aria-labelledby="sec-details-title">
        <h2 id="sec-details-title" className="section-title">
          <span className="section-num">1</span> Your gold &amp; contact details
        </h2>
        <DetailsStep
          values={values}
          errors={errors}
          touched={touched}
          quote={quote}
          onChange={change}
          onTouch={touch}
          onContinue={() => scrollToId(SECTION_ID[2])}
        />
      </section>

      <section id={SECTION_ID[2]} className="apply-section" aria-labelledby="sec-plan-title">
        <h2 id="sec-plan-title" className="section-title">
          <span className="section-num">2</span> Choose your plan
        </h2>
        <PlanStep
          quote={quote}
          planId={planId}
          onSelect={(id) => {
            setPlanId(id);
            setSubmit({ status: 'idle' });
          }}
          onReview={() => scrollToId(SECTION_ID[3])}
        />
      </section>

      <section id={SECTION_ID[3]} className="apply-section" aria-labelledby="sec-review-title">
        <h2 id="sec-review-title" className="section-title">
          <span className="section-num">3</span> Review &amp; submit
        </h2>
        <ConfirmStep
          values={values}
          errors={errors}
          quote={quoteData}
          plan={selectedPlan}
          submit={submit}
          onFixField={fixField}
          onChoosePlan={() => scrollToId(SECTION_ID[2])}
          onSubmit={() => void submitApplication()}
        />
      </section>
    </section>
  );
}
