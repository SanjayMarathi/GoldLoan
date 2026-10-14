import type { ProviderSet } from '../src/agent/providers/factory.ts';
import { loadConfig } from '../src/config.ts';
import { buildContainer } from '../src/container.ts';
import type { Container } from '../src/container.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { createNoopLogger } from '../src/lib/noopLogger.ts';

export interface TestWorld {
  container: Container;
  clock: FakeClock;
}

/** A full in-memory app: fake clock, silent logger, offline assistant, ₹7,000/g gold. */
export function makeWorld(options: { providers?: ProviderSet; env?: Record<string, string> } = {}): TestWorld {
  const clock = new FakeClock('2026-10-01T09:00:00.000Z');
  const config = loadConfig({ LLM_PROVIDER: 'offline', DB_DRIVER: 'memory', ...options.env });
  const container = buildContainer(config, {
    logger: createNoopLogger(),
    clock,
    ...(options.providers ? { providers: options.providers } : {}),
  });
  return { container, clock };
}

export const VALID_LEAD = {
  name: 'Ravi Kumar',
  mobileNumber: '9876543210',
  grossWeightGrams: 50,
  netWeightGrams: 45,
  karat: 22,
  planId: 'PLAN_EMI_01',
} as const;
