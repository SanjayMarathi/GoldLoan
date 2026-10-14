import type { FormEvent } from 'react';
import { KARATS } from '@gold/shared/constants';
import { formatGramsFromMg, formatPaise } from '@gold/shared/format';
import type { QuoteState } from '../hooks/useQuote.ts';
import { digitsOnly, weightText } from '../lib/details.ts';
import type { DetailsErrors, DetailsField, DetailsValues } from '../lib/details.ts';
import { Field } from './Field.tsx';
import { Icon } from './Icon.tsx';

interface DetailsStepProps {
  values: DetailsValues;
  errors: DetailsErrors;
  touched: Partial<Record<DetailsField, boolean>>;
  quote: QuoteState;
  onChange: (patch: Partial<DetailsValues>) => void;
  onTouch: (field: DetailsField) => void;
  onContinue: () => void;
}

export function DetailsStep({ values, errors, touched, quote, onChange, onTouch, onContinue }: DetailsStepProps) {
  const err = (f: DetailsField): string | undefined => (touched[f] ? errors[f] : undefined);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    onContinue();
  };

  return (
    <form onSubmit={submit} noValidate className="form" aria-label="Your details">
      <div className="grid-2">
        <Field id="name" label="Full name" error={err('name')} hint="As on your ID – letters and spaces only">
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={60}
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value.replace(/[^\p{L}\p{M} ]/gu, '') })}
            onBlur={() => onTouch('name')}
            aria-invalid={Boolean(err('name'))}
            aria-describedby="name-msg"
            placeholder="e.g. Ravi Kumar"
          />
        </Field>

        <Field id="mobile" label="Mobile number" error={err('mobileNumber')} hint="10 digits, starting with 6, 7, 8 or 9">
          <div className="input-prefix">
            <span aria-hidden="true">+91</span>
            <input
              id="mobile"
              name="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              enterKeyHint="next"
              maxLength={10}
              value={values.mobile}
              onChange={(e) => onChange({ mobile: digitsOnly(e.target.value, 10) })}
              onBlur={() => onTouch('mobileNumber')}
              aria-invalid={Boolean(err('mobileNumber'))}
              aria-describedby="mobile-msg"
              placeholder="98765 43210"
            />
          </div>
        </Field>
      </div>

      <div className="grid-3">
        <Field id="gross" label="Gross weight (g)" error={err('grossWeightGrams')} hint="With stones, if any">
          <input
            id="gross"
            name="gross"
            type="text"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            value={values.gross}
            onChange={(e) => onChange({ gross: weightText(e.target.value) })}
            onBlur={() => onTouch('grossWeightGrams')}
            aria-invalid={Boolean(err('grossWeightGrams'))}
            aria-describedby="gross-msg"
            placeholder="50"
          />
        </Field>
        <Field id="net" label="Net weight (g)" error={err('netWeightGrams')} hint="Gold only – no stones">
          <input
            id="net"
            name="net"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            value={values.net}
            onChange={(e) => onChange({ net: weightText(e.target.value) })}
            onBlur={() => onTouch('netWeightGrams')}
            aria-invalid={Boolean(err('netWeightGrams'))}
            aria-describedby="net-msg"
            placeholder="45"
          />
        </Field>
        <div className="field">
          <span className="label" id="karat-label">
            Purity (karat)
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="karat-label">
            {KARATS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={values.karat === k}
                className={values.karat === k ? 'on' : ''}
                onClick={() => onChange({ karat: k })}
              >
                {k}K
              </button>
            ))}
          </div>
          <p className="field-msg">{values.karat === 24 ? 'Pure gold' : values.karat === 22 ? 'Most jewellery' : 'Mixed with other metals'}</p>
        </div>
      </div>

      <LivePreview quote={quote} />

      <button type="submit" className="btn btn-ghost btn-block">
        Continue to plans
      </button>
    </form>
  );
}

/** Updates ~300 ms after you stop typing. Shows the previous figures (dimmed) while the next ones load. */
function LivePreview({ quote }: { quote: QuoteState }) {
  const data = quote.status === 'idle' ? undefined : quote.data;
  const loading = quote.status === 'loading';

  if (!data) {
    return (
      <div className="live-preview empty" aria-live="polite">
        <Icon name="bolt" size={18} />
        <span>
          {quote.status === 'error' ? quote.message : 'Enter your gold’s weight and karat to see a live estimate.'}
        </span>
      </div>
    );
  }
  const best = Math.max(...data.plans.map((p) => p.eligibleLoanRupees));
  return (
    <div className={`live-preview${loading ? ' loading' : ''}`} aria-live="polite" aria-busy={loading}>
      <div>
        <span className="lp-label">Pure gold</span>
        <b>{formatGramsFromMg(data.pureGoldMg)}</b>
      </div>
      <div>
        <span className="lp-label">Gold value</span>
        <b>{formatPaise(data.goldValuePaise)}</b>
      </div>
      <div>
        <span className="lp-label">Loan up to</span>
        <b className="hl">₹{best.toLocaleString('en-IN')}</b>
      </div>
    </div>
  );
}
