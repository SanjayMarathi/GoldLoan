import type { ReactNode } from 'react';

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}

/** Label + control + hint/error, wired for screen readers (the control gets aria-describedby = `${id}-msg`). */
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      <p id={`${id}-msg`} className={error ? 'field-msg error' : 'field-msg'} aria-live="polite">
        {error ?? hint ?? ' '}
      </p>
    </div>
  );
}
