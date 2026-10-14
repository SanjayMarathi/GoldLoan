import pino from 'pino';
import type { Logger } from 'pino';
import { scrubDeep, scrubPII } from '@gold/shared/mask';

export type { Logger };

/**
 * Structured JSON logger with PII scrubbing built in:
 *  • any key that looks like a mobile number is masked (9876XXXX10)
 *  • any 10-digit run inside a string or message is masked
 * so a mobile number can never be written to the logs by accident.
 */
export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      log: (object) => scrubDeep(object) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === 'string' ? scrubPII(a) : a));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        method.apply(this, scrubbed as any);
      },
    },
  });
}

/** A logger that discards everything (tests). */
export function createSilentLogger(): Logger {
  return createLogger('silent');
}
