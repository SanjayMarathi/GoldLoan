import type { Clock } from '../lib/clock.ts';
import type { LoanScheme } from '../domain/LoanScheme.ts';
import type { LoanSchemeRepository } from './interfaces.ts';

/**
 * Decorator that keeps the (tiny, rarely-changing) list of active plans in memory for `ttlMs`.
 * POST /quotes is called on every debounced keystroke, so with this it never touches the database.
 */
export class CachedLoanSchemeRepository implements LoanSchemeRepository {
  private readonly inner: LoanSchemeRepository;
  private readonly ttlMs: number;
  private readonly clock: Clock;
  private cache: { schemes: LoanScheme[]; expiresAt: number } | null = null;
  private inFlight: Promise<LoanScheme[]> | null = null;

  constructor(inner: LoanSchemeRepository, ttlMs: number, clock: Clock) {
    this.inner = inner;
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  async listActive(): Promise<LoanScheme[]> {
    const now = this.clock.now().getTime();
    if (this.cache && this.cache.expiresAt > now) return this.cache.schemes;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.inner
      .listActive()
      .then((schemes) => {
        this.cache = { schemes, expiresAt: this.clock.now().getTime() + this.ttlMs };
        return schemes;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async findActiveById(id: string): Promise<LoanScheme | null> {
    const schemes = await this.listActive();
    return schemes.find((s) => s.id === id) ?? null;
  }
}
