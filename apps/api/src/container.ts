/**
 * Composition root – the one place where concrete classes are chosen and wired together.
 * Everything else depends on interfaces, which is what makes the app testable and the LLM / DB swappable.
 *
 *   repositories ─▶ QuoteService ─▶ LeadService ─▶ REST routes
 *                          └───────────┴────────▶ Agent tools ─▶ AgentOrchestrator ─▶ chat routes
 */
import { AgentOrchestrator } from './agent/AgentOrchestrator.ts';
import { createProviders } from './agent/providers/factory.ts';
import type { ProviderSet } from './agent/providers/factory.ts';
import { SessionStore } from './agent/SessionStore.ts';
import { createToolRegistry } from './agent/tools.ts';
import type { AppConfig } from './config.ts';
import { QuoteCalculator } from './domain/QuoteCalculator.ts';
import { SystemClock } from './lib/clock.ts';
import type { Clock } from './lib/clock.ts';
import type { Logger } from './lib/logger.ts';
import { FixedWindowRateLimiter } from './lib/rateLimiter.ts';
import { CachedLoanSchemeRepository } from './repositories/cached.ts';
import type { Repositories } from './repositories/interfaces.ts';
import { MemoryRepositories } from './repositories/memory.ts';
import { CachedGoldRateProvider, MockGoldRateProvider } from './services/GoldRate.ts';
import type { GoldRateProvider } from './services/GoldRate.ts';
import { LeadService } from './services/LeadService.ts';
import { QuoteService } from './services/QuoteService.ts';

export interface Container {
  config: AppConfig;
  logger: Logger;
  clock: Clock;
  repositories: Repositories;
  calculator: QuoteCalculator;
  goldRate: GoldRateProvider;
  quoteService: QuoteService;
  leadService: LeadService;
  agent: AgentOrchestrator;
  sessions: SessionStore;
  limiters: { leads: FixedWindowRateLimiter; lookup: FixedWindowRateLimiter; chat: FixedWindowRateLimiter };
}

export interface ContainerDeps {
  logger: Logger;
  clock?: Clock;
  repositories?: Repositories;
  /** Tests / evals inject providers (e.g. the offline one, or a scripted fake) */
  providers?: ProviderSet;
}

const SCHEME_CACHE_TTL_MS = 60_000;

/** Loan plans change rarely and are read on every keystroke-quote, so wrap them in a short cache. */
function withCachedSchemes(repos: Repositories, clock: Clock): Repositories {
  if (repos.kind === 'memory') return repos; // already in memory
  return {
    kind: repos.kind,
    schemes: new CachedLoanSchemeRepository(repos.schemes, SCHEME_CACHE_TTL_MS, clock),
    leads: repos.leads,
    ping: () => repos.ping(),
    close: () => repos.close(),
  };
}

export function buildContainer(config: AppConfig, deps: ContainerDeps): Container {
  const clock = deps.clock ?? new SystemClock();
  const { logger } = deps;
  const repositories = withCachedSchemes(deps.repositories ?? new MemoryRepositories(), clock);

  const calculator = new QuoteCalculator();
  const goldRate = new CachedGoldRateProvider(
    new MockGoldRateProvider(config.goldRate.rate24kPaisePerGram, clock),
    config.goldRate.cacheTtlMs,
    clock,
  );
  const quoteService = new QuoteService({ schemes: repositories.schemes, goldRate, calculator });
  const leadService = new LeadService({ leads: repositories.leads, quotes: quoteService, clock, logger });

  const providers = deps.providers ?? createProviders(config.llm);
  const sessions = new SessionStore(config.agent.sessionTtlMs, clock);
  const agent = new AgentOrchestrator({
    provider: providers.primary,
    fallbackProvider: providers.fallback,
    tools: createToolRegistry({ quotes: quoteService, leads: leadService }),
    sessions,
    leads: leadService,
    clock,
    logger,
    maxToolSteps: config.agent.maxToolSteps,
  });

  const limiters = {
    leads: new FixedWindowRateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.leadsMax, clock }),
    lookup: new FixedWindowRateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.leadsMax, clock }),
    chat: new FixedWindowRateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.chatMax, clock }),
  };

  return { config, logger, clock, repositories, calculator, goldRate, quoteService, leadService, agent, sessions, limiters };
}
