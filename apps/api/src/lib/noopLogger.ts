import type { Logger } from './logger.ts';

/**
 * A logger that discards everything and has no dependencies (not even pino).
 * Used by unit tests, the HTTP tests and `npm run eval`.
 */
export function createNoopLogger(): Logger {
  const noop = (): void => {};
  const logger: Record<string, unknown> = {
    level: 'silent',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    silent: noop,
  };
  logger.child = () => logger;
  return logger as unknown as Logger;
}
