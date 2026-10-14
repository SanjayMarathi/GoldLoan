import type { LeadStatus } from '@gold/shared/constants';

export const STATUS_LABEL: Record<LeadStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/** The button an admin presses to move a lead INTO this status. */
export const ACTION_LABEL: Record<LeadStatus, string> = {
  SUBMITTED: 'Reopen',
  UNDER_REVIEW: 'Start review',
  APPROVED: 'Approve',
  REJECTED: 'Reject',
};

/** What the status means for the applicant. */
export const STATUS_HELP: Record<LeadStatus, string> = {
  SUBMITTED: 'We have your application. Our team will start reviewing it shortly.',
  UNDER_REVIEW: 'Our team is reviewing your application. We will call you to book a free gold appraisal.',
  APPROVED: 'Approved in principle. The final amount is confirmed after the physical appraisal of your gold.',
  REJECTED: 'We could not approve this application. You can apply again after 7 days from the original date.',
};
