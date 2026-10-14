import type { ErrorBody, FieldError } from '@gold/shared/types';

/**
 * Error contract: every error body is { error: { code, message, fields[], details? } }.
 * Throw an AppError anywhere; the global error handler turns it into JSON.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields: FieldError[];
  readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { fields?: FieldError[]; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.fields = options.fields ?? [];
    this.details = options.details;
  }

  toBody(): ErrorBody {
    const body: ErrorBody = { error: { code: this.code, message: this.message, fields: this.fields } };
    if (this.details) body.error.details = this.details;
    return body;
  }
}

/** 400 – the request failed schema / business-rule validation. */
export class ValidationError extends AppError {
  constructor(fields: FieldError[], message = 'Some fields are invalid. Please correct them and try again.') {
    super(400, 'VALIDATION_ERROR', message, { fields });
  }
}

/** 404 */
export class NotFoundError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(404, code, message, details ? { details } : {});
  }
}

export class PlanNotFoundError extends NotFoundError {
  constructor(planId: string) {
    super('PLAN_NOT_FOUND', `Loan plan "${planId}" does not exist.`, { planId });
  }
}

/** 409 – same mobile applied within the last 7 days. Carries the existing application. */
export class DuplicateApplicationError extends AppError {
  constructor(applicationId: string, appliedAt: Date) {
    super(
      409,
      'DUPLICATE_APPLICATION',
      `An application already exists for this mobile number (${applicationId}). A new one can be filed after 7 days.`,
      { details: { applicationId, appliedAt: appliedAt.toISOString() } },
    );
  }
}

export class InvalidStatusTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, 'INVALID_STATUS_TRANSITION', `A lead in status ${from} cannot move to ${to}.`, { details: { from, to } });
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request body.');
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', `Too many requests. Please retry in ${retryAfterSeconds}s.`, {
      details: { retryAfterSeconds },
    });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Something went wrong on our side. Please try again.') {
    super(500, 'INTERNAL_ERROR', message);
  }
}
