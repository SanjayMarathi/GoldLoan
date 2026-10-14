import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { zodToFieldErrors } from '@gold/shared/schemas';
import { ValidationError } from '../../lib/errors.ts';

/** Validate (and strip unknown keys from) the JSON body. On failure → 400 with fields[]. */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(new ValidationError(zodToFieldErrors(result.error)));
    req.body = result.data;
    next();
  };
}

/** Validate the query string; the parsed value is available as res.locals.query. */
export function validateQuery(schema: ZodTypeAny): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(new ValidationError(zodToFieldErrors(result.error)));
    res.locals.query = result.data;
    next();
  };
}
