import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../../lib/logger.ts';

const SAFE_ID = /^[\w.-]{8,64}$/;

/** Assigns a request id and writes one access-log line per request (path only, never bodies or query strings). */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
      const level = req.path.endsWith('/health') ? 'debug' : res.statusCode >= 500 ? 'error' : 'info';
      logger[level]({ requestId, method: req.method, path: req.path, status: res.statusCode, ms }, 'request');
    });
    next();
  };
}
