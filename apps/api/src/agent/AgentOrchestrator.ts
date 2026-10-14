/**
 * AgentOrchestrator – runs one chat turn.
 *
 *   user text ─▶ InputGuard ─▶ [ LLM ⇄ tools ]* ─▶ GroundingGuard ─▶ reply (+ confirmation card)
 *
 * Safety is structural, not a matter of trusting the model:
 *   • the model only ever sees tool results; every figure it states is checked against them (GroundingGuard);
 *   • `submit_application` merely stores a PENDING action – only POST /chat/confirm (a button click, never
 *     free text) calls LeadService.submit, with the payload the server stored, not anything the client sends;
 *   • the same LeadService serves the form and the agent, so both create identical leads;
 *   • if the LLM is down the turn degrades to the rule-based assistant instead of failing.
 */
import { formatRupees } from '@gold/shared/format';
import type { ChatReplyDto, ChatToolEvent } from '@gold/shared/types';
import { NotFoundError } from '../lib/errors.ts';
import type { Clock } from '../lib/clock.ts';
import type { Logger } from '../lib/logger.ts';
import type { LeadService } from '../services/LeadService.ts';
import { GroundingGuard } from './guards/GroundingGuard.ts';
import { InputGuard } from './guards/InputGuard.ts';
import { buildSystemPrompt } from './prompt.ts';
import type { ChatSession, SessionStore } from './SessionStore.ts';
import { detectLocale, templates } from './templates.ts';
import type { ChatMessage, LlmProvider, LlmRequest, LlmResponse, ToolCall, ToolExecutor, ToolResult } from './types.ts';
import { LlmUnavailableError } from './types.ts';

export interface AgentDeps {
  provider: LlmProvider;
  /** Used when `provider` is unreachable. Omit when `provider` is already the offline assistant. */
  fallbackProvider?: LlmProvider | undefined;
  tools: ToolExecutor;
  sessions: SessionStore;
  leads: LeadService;
  clock: Clock;
  logger: Logger;
  maxToolSteps: number;
  inputGuard?: InputGuard;
  groundingGuard?: GroundingGuard;
}

const MAX_USER_TURNS_IN_CONTEXT = 40;

/** Keep the last N user turns (cut at a user message so tool calls are never orphaned). */
export function windowMessages(messages: ChatMessage[], maxUserTurns = MAX_USER_TURNS_IN_CONTEXT): ChatMessage[] {
  let seen = 0;
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role !== 'user') continue;
    seen += 1;
    if (seen > maxUserTurns) return messages.slice(start);
    start = i; // earliest user message that still fits in the window
  }
  return messages;
}

function indiaDate(now: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now);
}

interface TurnState {
  events: ChatToolEvent[];
  provider: LlmProvider;
  degraded: boolean;
}

export class AgentOrchestrator {
  private readonly provider: LlmProvider;
  private readonly fallbackProvider: LlmProvider | undefined;
  private readonly tools: ToolExecutor;
  private readonly sessions: SessionStore;
  private readonly leads: LeadService;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly maxToolSteps: number;
  private readonly inputGuard: InputGuard;
  private readonly groundingGuard: GroundingGuard;

  constructor(deps: AgentDeps) {
    this.provider = deps.provider;
    this.fallbackProvider = deps.fallbackProvider;
    this.tools = deps.tools;
    this.sessions = deps.sessions;
    this.leads = deps.leads;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.maxToolSteps = deps.maxToolSteps;
    this.inputGuard = deps.inputGuard ?? new InputGuard();
    this.groundingGuard = deps.groundingGuard ?? new GroundingGuard();
  }

  get providerName(): string {
    return this.provider.name;
  }

  /* ───────────────────────── one user message ───────────────────────── */

  async handleMessage(sessionId: string | undefined, message: string): Promise<ChatReplyDto> {
    const session = this.sessions.getOrCreate(sessionId);
    return this.sessions.withLock(session.id, () => this.runTurn(session, message));
  }

  private async runTurn(session: ChatSession, message: string): Promise<ChatReplyDto> {
    const verdict = this.inputGuard.inspect(message);
    if (!verdict.ok) {
      const T = templates(session.locale);
      this.logger.warn({ sessionId: session.id.slice(0, 8), reason: verdict.reason }, 'agent input rejected by guard');
      // Rejected text never enters the history, so it can never influence a later model call.
      return this.buildReply(session, verdict.reason === 'INJECTION' ? T.injection() : T.generic(), {
        events: [],
        provider: this.provider,
        degraded: false,
      });
    }

    const text = verdict.text;
    session.locale = detectLocale(text, session.locale);
    session.absorbFigures(text); // what the user typed counts as grounded
    session.messages.push({ role: 'user', content: text });

    const turn: TurnState = { events: [], provider: this.provider, degraded: false };
    const started = performance.now();
    let finalText: string | null = null;

    try {
      for (let step = 0; step < this.maxToolSteps && finalText === null; step++) {
        const response = await this.complete(session, turn, this.requestFor(session));
        const calls = response.toolCalls.map((c, i) => ({ ...c, id: c.id || `call_${session.messages.length}_${i}` }));

        if (calls.length === 0) {
          finalText = await this.finalizeText(session, turn, response);
          break;
        }

        // Text written alongside tool calls is never shown or stored – only the final reply is.
        session.messages.push({
          role: 'assistant',
          content: '',
          toolCalls: calls,
          ...(response.meta ? { meta: response.meta } : {}),
          ...(response.providerContent ? { providerContent: response.providerContent } : {}),
        });
        for (const call of calls) await this.runTool(session, turn, call);
      }
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      // No model and no fallback: say so politely (the form still works) and keep the history well-formed.
      turn.degraded = true;
      finalText = templates(session.locale).llmUnavailable();
      session.messages.push({ role: 'assistant', content: finalText, meta: { kind: 'DEGRADED' } });
    }

    if (finalText === null) {
      this.logger.warn({ sessionId: session.id.slice(0, 8), steps: this.maxToolSteps }, 'agent hit the tool-step limit');
      finalText = this.safeReply(session);
      session.messages.push({ role: 'assistant', content: finalText, meta: { kind: 'GUARD' } });
    }

    this.logger.info(
      {
        sessionId: session.id.slice(0, 8),
        provider: turn.provider.name,
        degraded: turn.degraded,
        tools: turn.events.map((e) => `${e.tool}:${e.status}`),
        ms: Math.round(performance.now() - started),
      },
      'agent turn complete',
    );
    return this.buildReply(session, finalText, turn);
  }

  /* ───────────────────────── Confirm / Cancel button ───────────────────────── */

  async handleConfirmation(sessionId: string, actionId: string, decision: 'confirm' | 'cancel'): Promise<ChatReplyDto> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError('SESSION_NOT_FOUND', 'This chat session has expired. Please start a new chat.');
    }
    return this.sessions.withLock(session.id, async () => {
      // A double-click (or a retry after a network blip) gets the same answer, never a second submission.
      const done = session.completed.get(actionId);
      if (done) return done;

      const pending = session.pending;
      if (!pending || pending.actionId !== actionId) {
        throw new NotFoundError('ACTION_NOT_FOUND', 'This summary is no longer valid. Please ask me to prepare it again.');
      }
      const T = templates(session.locale);
      const turn: TurnState = { events: [], provider: this.provider, degraded: false };

      if (decision === 'cancel') {
        session.pending = null;
        const reply = T.cancelled();
        session.messages.push({ role: 'assistant', content: reply, meta: { kind: 'CANCELLED' } });
        const dto = this.buildReply(session, reply, turn);
        session.completed.set(actionId, dto);
        return dto;
      }

      const result = await this.leads.submit(pending.payload, {
        channel: 'AGENT',
        idempotencyKey: `agent-${actionId}`,
        actor: 'applicant',
      });
      session.pending = null;

      let reply: string;
      let submitted: ChatReplyDto['submitted'] = null;
      if (result.statusCode === 201) {
        const id = result.body.applicationId;
        session.knownFigures.add(id.toUpperCase());
        session.submittedIds.push(id);
        submitted = { applicationId: id, eligibleLoanRupees: pending.summary.eligibleLoanRupees };
        reply = T.submitted(id, formatRupees(pending.summary.eligibleLoanRupees), pending.summary.planName);
        turn.events.push({ tool: 'submit_application', status: 'ok', label: 'Application submitted' });
        session.messages.push({ role: 'assistant', content: reply, meta: { kind: 'SUBMITTED' } });
      } else {
        const details = result.body.error.details ?? {};
        const existingId = String(details.applicationId ?? '');
        const appliedAt = typeof details.appliedAt === 'string' ? details.appliedAt : this.clock.now().toISOString();
        session.knownFigures.add(existingId.toUpperCase());
        reply = T.duplicateAtConfirm(existingId, new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(appliedAt)));
        turn.events.push({ tool: 'submit_application', status: 'error', label: 'Already applied' });
        session.messages.push({ role: 'assistant', content: reply, meta: { kind: 'BLOCKED' } });
      }

      const dto = this.buildReply(session, reply, turn, submitted);
      session.completed.set(actionId, dto);
      return dto;
    });
  }

  /* ───────────────────────── internals ───────────────────────── */

  private requestFor(session: ChatSession, toolChoice: 'auto' | 'none' = 'auto'): LlmRequest {
    return {
      system: buildSystemPrompt(indiaDate(this.clock.now())),
      messages: windowMessages(session.messages),
      tools: this.tools.definitions(),
      toolChoice,
    };
  }

  /** Ask the model; if it is unreachable, finish this turn with the offline assistant. */
  private async complete(session: ChatSession, turn: TurnState, request: LlmRequest): Promise<LlmResponse> {
    try {
      return await turn.provider.complete(request);
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      this.logger.warn({ sessionId: session.id.slice(0, 8), provider: turn.provider.name, err: error.message }, 'LLM unavailable');
      if (!this.fallbackProvider || turn.provider === this.fallbackProvider) throw error;
      turn.provider = this.fallbackProvider;
      turn.degraded = true;
      return turn.provider.complete(request);
    }
  }

  private async runTool(session: ChatSession, turn: TurnState, call: ToolCall): Promise<void> {
    let result: ToolResult;
    let label = call.name;
    try {
      const outcome = await this.tools.execute(call, { session });
      result = outcome.result;
      label = outcome.label;
    } catch (error) {
      this.logger.error({ sessionId: session.id.slice(0, 8), tool: call.name, err: error }, 'tool crashed');
      result = {
        ok: false,
        error: { code: 'TOOL_FAILED', message: 'The tool failed unexpectedly. Apologise briefly and ask the user to try again.', fields: [] },
      };
    }
    turn.events.push({ tool: call.name, status: result.ok ? 'ok' : 'error', label });
    const payload = JSON.stringify(result);
    session.absorbFigures(payload); // tool output is the ground truth the model may quote
    session.messages.push({ role: 'tool', content: payload, toolCallId: call.id, toolName: call.name });
  }

  /** Grounding check on the model's final text: one corrective retry, then a safe canned reply. */
  private async finalizeText(session: ChatSession, turn: TurnState, response: LlmResponse): Promise<string> {
    let text = (response.text ?? '').trim();
    let meta = response.meta;
    // Only an untouched model reply is stored for verbatim replay. A corrected or canned reply is stored as
    // plain text: the corrective request had extra messages, so its blocks belong to a different conversation.
    let providerContent = response.providerContent;
    let problems: string[] = [];

    if (text) {
      problems = this.groundingGuard.check(text, session.knownFigures, { submissionConfirmed: false }).problems;
      if (problems.length > 0 && !turn.degraded) {
        this.logger.warn({ sessionId: session.id.slice(0, 8), problems }, 'reply failed the grounding check – retrying once');
        const retry = await this.retryGrounded(session, turn, text, problems);
        if (retry) {
          text = retry.text;
          meta = retry.meta;
          providerContent = undefined;
          problems = [];
        }
      }
    }

    if (!text || problems.length > 0) {
      text = this.safeReply(session);
      session.messages.push({ role: 'assistant', content: text, meta: { kind: 'GUARD' } });
      return text;
    }

    session.messages.push({ role: 'assistant', content: text, ...(meta ? { meta } : {}), ...(providerContent ? { providerContent } : {}) });
    return text;
  }

  private async retryGrounded(
    session: ChatSession,
    turn: TurnState,
    draft: string,
    problems: string[],
  ): Promise<{ text: string; meta: LlmResponse['meta'] } | null> {
    const request = this.requestFor(session, 'none');
    request.messages = [
      ...request.messages,
      { role: 'assistant', content: draft },
      {
        role: 'user',
        content:
          `[automatic check] Your last reply was rejected: ${problems.join('; ')}. ` +
          'Rewrite it. Use ONLY figures and ids that appear in the tool results above, copied exactly, ' +
          'never say an application is submitted, and make no promises about approval.',
      },
    ];
    try {
      const retry = await turn.provider.complete(request);
      const text = (retry.text ?? '').trim();
      if (!text) return null;
      const again = this.groundingGuard.check(text, session.knownFigures, { submissionConfirmed: false });
      return again.ok ? { text, meta: retry.meta } : null;
    } catch (error) {
      if (error instanceof LlmUnavailableError) return null;
      throw error;
    }
  }

  /** A reply built only from server-side data – used when the model's text cannot be trusted. */
  private safeReply(session: ChatSession): string {
    const T = templates(session.locale);
    if (session.pending) return T.confirmPrompt();
    if (session.lastQuoteDisplay) return T.quote(session.lastQuoteDisplay);
    return T.generic();
  }

  private buildReply(
    session: ChatSession,
    reply: string,
    turn: TurnState,
    submitted: ChatReplyDto['submitted'] = null,
  ): ChatReplyDto {
    return {
      sessionId: session.id,
      reply,
      toolEvents: turn.events,
      pendingConfirmation: session.pending ? { actionId: session.pending.actionId, summary: session.pending.summary } : null,
      submitted,
      provider: turn.provider.name,
      degraded: turn.degraded,
    };
  }
}
