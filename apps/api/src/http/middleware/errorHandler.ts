import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFoundError } from '../../lib/errors.ts';
import type { Logger } from '../../lib/logger.ts';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError('ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} does not exist.`));
};

/**
 * The one place errors become responses. Always JSON, always the same shape,
 * and a 500 never leaks a stack trace (it is logged server-side with the request id).
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const requestId = res.locals.requestId as string | undefined;

    if (err instanceof AppError) {
      if (err.statusCode === 429 && typeof err.details?.retryAfterSeconds === 'number') {
        res.setHeader('Retry-After', String(err.details.retryAfterSeconds));
      }
      res.status(err.statusCode).json(err.toBody());
      return;
    }

    // body-parser errors carry a `type`
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') {
      res.status(400).json(new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON.').toBody());
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json(new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.').toBody());
      return;
    }

    logger.error({ err, requestId, method: req.method, path: req.path }, 'unhandled error');
    const body = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', {
      details: requestId ? { requestId } : {},
    });
    res.status(500).json(body.toBody());
  };
}
