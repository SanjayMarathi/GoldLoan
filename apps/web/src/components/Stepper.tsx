import { Icon } from './Icon.tsx';

const STEPS = ['Your gold', 'Choose plan', 'Review & submit'] as const;

interface StepperProps {
  /** The step the applicant is on (4 = submitted) */
  step: 1 | 2 | 3 | 4;
  /** Which steps are complete. Defaults to "every step before `step`". */
  done?: [boolean, boolean, boolean];
  /** When given, each step is a button that scrolls to its section. */
  onJump?: (step: 1 | 2 | 3) => void;
}

export function Stepper({ step, done, onJump }: StepperProps) {
  return (
    <ol className="stepper" aria-label="Application progress">
      {STEPS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const isDone = done ? done[i] : step > n;
        const state = step === n ? 'current' : isDone ? 'done' : 'todo';
        const content = (
          <>
            <span className="step-dot">{isDone && step !== n ? <Icon name="check" size={14} /> : n}</span>
            <span className="step-label">{label}</span>
          </>
        );
        return (
          <li key={label} className={`step ${state}${isDone ? ' complete' : ''}`} aria-current={state === 'current' ? 'step' : undefined}>
            {onJump ? (
              <button type="button" className="step-btn" onClick={() => onJump(n)}>
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}
