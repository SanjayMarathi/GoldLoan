import type { CreateLeadResponse } from '@gold/shared/types';
import { ApplicationDetails } from './ApplicationDetails.tsx';
import { Icon } from './Icon.tsx';

interface SuccessScreenProps {
  response: CreateLeadResponse;
  onNew: () => void;
  onTrack: () => void;
}

/** After submitting: the application id, then every detail of what was filed. */
export function SuccessScreen({ response, onNew, onTrack }: SuccessScreenProps) {
  return (
    <div className="success">
      <div className="success-top" role="status">
        <div className="success-icon">
          <Icon name="check" size={34} />
        </div>
        <h1 tabIndex={-1}>Application submitted</h1>
        <p className="muted">Your application ID – keep it with your mobile number to track your application</p>
        <div className="app-id" aria-label={`Application ID ${response.applicationId}`}>
          {response.applicationId}
        </div>
      </div>

      <ApplicationDetails lead={response.lead} audience="applicant" />

      <div className="next-steps-box">
        <h3>What happens next</h3>
        <ol className="next-steps">
          <li>Our team reviews your application.</li>
          <li>You’ll be called on your mobile to book a free gold appraisal.</li>
          <li>The final amount is confirmed after the appraisal – this is an estimate, not a promise of approval.</li>
        </ol>
      </div>

      <div className="actions center">
        <button type="button" className="btn btn-ghost" onClick={onTrack}>
          <Icon name="list" size={18} /> Track this application
        </button>
        <button type="button" className="btn btn-primary" onClick={onNew}>
          <Icon name="plus" size={18} /> New application
        </button>
      </div>
    </div>
  );
}
