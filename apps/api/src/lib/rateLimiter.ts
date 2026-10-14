import type { Clock } from './clock.ts';
import { SystemClock } from './clock.ts';

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

/** Small in-memory fixed-window limiter (one process). Swap for Redis when scaling out. */
export class FixedWindowRateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly clock: Clock;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(options: { windowMs: number; max: number; clock?: Clock }) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.clock = options.clock ?? new SystemClock();
  }

  consume(key: string): RateLimitDecision {
    const now = this.clock.now().getTime();
    if (this.hits.size > 10_000) this.prune(now);

    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= this.max;
    return {
      allowed,
      limit: this.max,
      remaining: Math.max(0, this.max - entry.count),
      retryAfterMs: allowed ? 0 : entry.resetAt - now,
    };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}
