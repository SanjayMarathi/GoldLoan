import { randomUUID } from 'node:crypto';
import type { CreateLeadInput } from '@gold/shared/schemas';
import type { ApplicationSummaryDto, ChatReplyDto } from '@gold/shared/types';
import type { Clock } from '../lib/clock.ts';
import type { QuoteDisplay } from './present.ts';
import type { Locale } from './templates.ts';
import type { ChatMessage } from './types.ts';

export interface PendingAction {
  actionId: string;
  payload: CreateLeadInput;
  summary: ApplicationSummaryDto;
  createdAt: number;
}

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;
const APPLICATION_ID = /GL-\d+/gi;

/** "2,88,750" → "288750", "41.250" → "41.25", "50.0" → "50" */
export function normalizeNumber(token: string): string {
  let s = token.replace(/,/g, '');
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** One chat conversation. */
export class ChatSession {
  readonly id: string;
  readonly createdAt: number;
  touchedAt: number;
  messages: ChatMessage[] = [];
  /** An application waiting for the user to press Confirm. Only a click on the card can submit it. */
  pending: PendingAction | null = null;
  /** Every number / application id the assistant is allowed to quote: tool outputs + what the user typed */
  readonly knownFigures = new Set<string>();
  submittedIds: string[] = [];
  /** actionId → reply, so a double-click on Confirm returns the same result instead of an error */
  readonly completed = new Map<string, ChatReplyDto>();
  /** The latest quote returned by calculate_quote (used for the safe fallback reply) */
  lastQuoteDisplay: QuoteDisplay | null = null;
  locale: Locale = 'en';

  constructor(id: string, now: number) {
    this.id = id;
    this.createdAt = now;
    this.touchedAt = now;
  }

  /** Remember all figures in `text` as "grounded". */
  absorbFigures(text: string): void {
    for (const token of text.match(NUMBER_TOKEN) ?? []) this.knownFigures.add(normalizeNumber(token));
    for (const id of text.match(APPLICATION_ID) ?? []) this.knownFigures.add(id.toUpperCase());
  }
}

/** In-memory sessions with TTL and a size cap. Swap for Redis to run more than one API instance. */
export class SessionStore {
  private readonly sessions = new Map<string, ChatSession>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly ttlMs: number;
  private readonly clock: Clock;
  private readonly maxSessions: number;

  constructor(ttlMs: number, clock: Clock, maxSessions = 2000) {
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.maxSessions = maxSessions;
  }

  /** Existing live session for `id`, or a brand-new one. */
  getOrCreate(id?: string): ChatSession {
    const now = this.clock.now().getTime();
    const existing = id ? this.get(id) : undefined;
    if (existing) return existing;
    if (this.sessions.size >= this.maxSessions) this.evict(now);
    const session = new ChatSession(randomUUID(), now);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ChatSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const now = this.clock.now().getTime();
    if (now - session.touchedAt > this.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }
    session.touchedAt = now;
    return session;
  }

  /** Serialise work per session so two quick messages can never interleave their histories. */
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.locks.set(id, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  private evict(now: number): void {
    for (const [id, s] of this.sessions) {
      if (now - s.touchedAt > this.ttlMs) this.sessions.delete(id);
    }
    if (this.sessions.size >= this.maxSessions) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (oldest) this.sessions.delete(oldest.id);
    }
  }
}
