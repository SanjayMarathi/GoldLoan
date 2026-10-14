import type { Clock } from '../lib/clock.ts';

export interface GoldRate {
  /** 24K gold, paise per gram */
  ratePerGram24kPaise: number;
  source: string;
  asOf: Date;
}

export interface GoldRateProvider {
  getRate(): Promise<GoldRate>;
}

/** The assignment's mock rate (₹7,000/g). Replace with a live market-data provider in production. */
export class MockGoldRateProvider implements GoldRateProvider {
  private readonly ratePerGram24kPaise: number;
  private readonly clock: Clock;

  constructor(ratePerGram24kPaise: number, clock: Clock) {
    this.ratePerGram24kPaise = ratePerGram24kPaise;
    this.clock = clock;
  }

  async getRate(): Promise<GoldRate> {
    return { ratePerGram24kPaise: this.ratePerGram24kPaise, source: 'mock', asOf: this.clock.now() };
  }
}

/**
 * Decorator: caches the inner provider for `ttlMs` and coalesces concurrent refreshes into one call.
 * Every quote and lead reads the rate, so this keeps the hot path off any slow upstream.
 */
export class CachedGoldRateProvider implements GoldRateProvider {
  private readonly inner: GoldRateProvider;
  private readonly ttlMs: number;
  private readonly clock: Clock;
  private cached: { value: GoldRate; expiresAt: number } | null = null;
  private inFlight: Promise<GoldRate> | null = null;

  constructor(inner: GoldRateProvider, ttlMs: number, clock: Clock) {
    this.inner = inner;
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  async getRate(): Promise<GoldRate> {
    const now = this.clock.now().getTime();
    if (this.cached && this.cached.expiresAt > now) return this.cached.value;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.inner
      .getRate()
      .then((value) => {
        this.cached = { value, expiresAt: this.clock.now().getTime() + this.ttlMs };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
