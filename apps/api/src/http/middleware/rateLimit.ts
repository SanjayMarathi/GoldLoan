import type { RequestHandler } from 'express';
import { RateLimitedError } from '../../lib/errors.ts';
import type { FixedWindowRateLimiter } from '../../lib/rateLimiter.ts';

export function rateLimit(limiter: FixedWindowRateLimiter): RequestHandler {
  return (req, res, next) => {
    const decision = limiter.consume(req.ip ?? 'unknown');
    res.setHeader('RateLimit-Limit', String(decision.limit));
    res.setHeader('RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      next(new RateLimitedError(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
      return;
    }
    next();
  };
}
