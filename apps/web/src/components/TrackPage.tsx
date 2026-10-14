import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LeadLookupSchema, zodToFieldErrors } from '@gold/shared/schemas';
import type { LeadDetailDto } from '@gold/shared/types';
import { ApiError, api } from '../api/client.ts';
import { digitsOnly } from '../lib/details.ts';
import { ApplicationDetails } from './ApplicationDetails.tsx';
import { Field } from './Field.tsx';
import { Icon } from './Icon.tsx';

type Lookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; lead: LeadDetailDto }
  | { status: 'error'; message: string };

/**
 * "Track my application" for applicants: application id + the mobile it was filed with.
 * Both must match (the server answers a wrong id and a wrong mobile identically), and the mobile stays masked.
 */
export function TrackPage({ initialId }: { initialId?: string | undefined }) {
  const [applicationId, setApplicationId] = useState(initialId ?? '');
  const [mobile, setMobile] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });
  const resultRef = useRef<HTMLDivElement>(null);

  // Opened from the sidebar history with an id: the id is filled in, the applicant only types their mobile.
  useEffect(() => {
    if (initialId) {
      setApplicationId(initialId);
      setLookup({ status: 'idle' });
      document.getElementById('track-mobile')?.focus();
    }
  }, [initialId]);

  const run = async (): Promise<void> => {
    const parsed = LeadLookupSchema.safeParse({ applicationId, mobileNumber: mobile });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(zodToFieldErrors(parsed.error).map((f) => [f.field, f.message])));
      return;
    }
    setFieldErrors({});
    setLookup({ status: 'loading' });
    try {
      const lead = await api.lookup(parsed.data);
      setLookup({ status: 'found', lead });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? 'Too many attempts. Please wait a minute and try again.'
          : error instanceof ApiError
            ? error.message
            : 'Something went wrong. Please try again.';
      setLookup({ status: 'error', message });
    }
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void run();
  };

  return (
    <section className="card wide-ish" aria-labelledby="track-title">
      <header className="card-head">
        <span className="eyebrow">For applicants</span>
        <h1 id="track-title">Track your application</h1>
        <p className="muted">Enter your application ID and the mobile number you applied with to see its status and every detail.</p>
      </header>

      <form className="track-form" onSubmit={onSubmit} noValidate aria-label="Find your application">
        <Field id="track-id" label="Application ID" error={fieldErrors.applicationId} hint="Shown after you applied, e.g. GL-1001">
          <input
            id="track-id"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={applicationId}
            onChange={(e) => setApplicationId(e.target.value.toUpperCase().slice(0, 14))}
            aria-invalid={Boolean(fieldErrors.applicationId)}
            aria-describedby="track-id-msg"
            placeholder="GL-1001"
          />
        </Field>
        <Field id="track-mobile" label="Mobile number" error={fieldErrors.mobileNumber} hint="The number you applied with">
          <div className="input-prefix">
            <span aria-hidden="true">+91</span>
            <input
              id="track-mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(digitsOnly(e.target.value, 10))}
              aria-invalid={Boolean(fieldErrors.mobileNumber)}
              aria-describedby="track-mobile-msg"
              placeholder="98765 43210"
            />
          </div>
        </Field>
        <button type="submit" className="btn btn-primary track-btn" disabled={lookup.status === 'loading'}>
          {lookup.status === 'loading' ? (
            <>
              <span className="spinner" aria-hidden="true" /> Checking…
            </>
          ) : (
            'Check status'
          )}
        </button>
      </form>

      {lookup.status === 'error' && (
        <div className="banner error" role="alert">
          <Icon name="alert" size={18} />
          <span>{lookup.message}</span>
        </div>
      )}

      {lookup.status === 'found' && (
        <div ref={resultRef} className="track-result">
          <div className="track-result-head">
            <h2>{lookup.lead.applicationId}</h2>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void run()}>
              <Icon name="refresh" size={16} /> Refresh
            </button>
          </div>
          <ApplicationDetails lead={lookup.lead} audience="applicant" />
        </div>
      )}
    </section>
  );
}
