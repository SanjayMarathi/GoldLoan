/**
 * RuleBasedProvider – the deterministic "offline assistant".
 *
 * It implements the SAME LlmProvider interface as the real model adapters, so the orchestrator,
 * tools, guards and confirmation flow are exercised identically. It is used
 *   • when no LLM key is configured (the app still works, clearly labelled "offline assistant"),
 *   • by `npm run eval` and the tests, so conversations are reproducible without network or keys.
 *
 * Stateless: everything is re-derived from the message history on each call.
 *   1. replay the history → slots (weights, karat, name, mobile, plan) + what tools have returned
 *   2. decide the next step: call a tool, or ask / answer in text
 * It never calculates money – every figure it prints was returned by a tool.
 */
import { formatGrams } from '@gold/shared/format';
import { hasAnySlot, parseUtterance } from '../nlu.ts';
import type { Intents, ParsedSlots } from '../nlu.ts';
import type { QuoteDisplay, SchemeDisplay } from '../present.ts';
import { detectLocale, templates } from '../templates.ts';
import type { Locale } from '../templates.ts';
import type { Expecting, LlmProvider, LlmRequest, LlmResponse, ToolCall, ToolResult } from '../types.ts';

type ToolErr = Extract<ToolResult, { ok: false }>['error'];

interface ExistingInfo {
  exists: boolean;
  applicationId?: string;
  appliedOn?: string;
}

interface Run {
  call: ToolCall;
  result: ToolResult | null;
}

interface DState {
  net?: number;
  gross?: number;
  karat?: number;
  name?: string;
  mobile?: string;
  planId?: string;
  planPref?: 'MAX_LOAN' | 'LOW_INTEREST';
  grossFollowsNet: boolean;
  netWasUnlabeled: boolean;
  applyMode: boolean;
  locale: Locale;
  /** What the assistant last asked for (consumed by the next user message) */
  expecting: Expecting;
  quotes: Map<string, QuoteDisplay>;
  quoteErrors: Map<string, ToolErr>;
  schemes: SchemeDisplay[] | null;
  existing: Map<string, ExistingInfo>;
  existingErrors: Map<string, ToolErr>;
  pendingKey: string | null;
  submitErrors: Map<string, ToolErr>;
  presented: Set<string>;
  // — about the latest user message —
  intents: Intents;
  slotsThisTurn: ParsedSlots;
  expectingAtTurn: Expecting;
  lastUserWords: number;
  runsThisTurn: Run[];
}

const NO_INTENTS: Intents = {
  greet: false,
  thanks: false,
  help: false,
  asksPlans: false,
  asksRate: false,
  wantsApply: false,
  affirm: false,
  negate: false,
  investment: false,
  approvalPromise: false,
  loanTopic: false,
  otherLoan: false,
  isQuestion: false,
};

function freshState(): DState {
  return {
    grossFollowsNet: false,
    netWasUnlabeled: false,
    applyMode: false,
    locale: 'en',
    expecting: null,
    quotes: new Map(),
    quoteErrors: new Map(),
    schemes: null,
    existing: new Map(),
    existingErrors: new Map(),
    pendingKey: null,
    submitErrors: new Map(),
    presented: new Set(),
    intents: NO_INTENTS,
    slotsThisTurn: {},
    expectingAtTurn: null,
    lastUserWords: 0,
    runsThisTurn: [],
  };
}

const quoteKey = (net: unknown, gross: unknown, karat: unknown): string => `${String(net)}|${String(gross)}|${String(karat)}`;

function argsOf(call: ToolCall): Record<string, unknown> {
  return call.arguments && typeof call.arguments === 'object' ? (call.arguments as Record<string, unknown>) : {};
}

function payloadKey(a: Record<string, unknown>): string {
  return [a.name, a.mobileNumber, a.grossWeightGrams, a.netWeightGrams, a.karat, a.planId].map(String).join('|');
}

function parseResult(content: string): ToolResult | null {
  try {
    const parsed = JSON.parse(content) as ToolResult;
    return parsed && typeof parsed === 'object' && 'ok' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

function applySlots(st: DState, s: ParsedSlots): void {
  if (s.netWeightGrams !== undefined) {
    st.net = s.netWeightGrams;
    st.netWasUnlabeled = Boolean(s.netWasUnlabeled);
  }
  if (s.grossWeightGrams !== undefined) {
    st.gross = s.grossWeightGrams;
    st.grossFollowsNet = false;
  }
  if (s.grossSameAsNet) st.grossFollowsNet = true;
  if (s.karat !== undefined) st.karat = s.karat;
  if (s.name !== undefined) st.name = s.name;
  if (s.mobileNumber !== undefined) st.mobile = s.mobileNumber;
  if (s.planId !== undefined) {
    st.planId = s.planId;
    delete st.planPref;
  }
  if (s.planPreference !== undefined) {
    st.planPref = s.planPreference;
    delete st.planId;
  }
}

function resetAfterSubmit(st: DState): void {
  delete st.net;
  delete st.gross;
  delete st.karat;
  delete st.name;
  delete st.mobile;
  delete st.planId;
  delete st.planPref;
  st.grossFollowsNet = false;
  st.netWasUnlabeled = false;
  st.applyMode = false;
  st.pendingKey = null;
  st.quotes.clear();
  st.quoteErrors.clear();
  st.existing.clear();
  st.existingErrors.clear();
  st.submitErrors.clear();
  st.presented.clear();
}

function absorbToolResult(st: DState, call: ToolCall | undefined, result: ToolResult | null): void {
  if (!call || !result) return;
  const args = argsOf(call);
  if (call.name === 'calculate_quote') {
    const key = quoteKey(args.netWeightGrams, args.grossWeightGrams, args.karat);
    if (result.ok) st.quotes.set(key, result.data as QuoteDisplay);
    else st.quoteErrors.set(key, result.error);
  } else if (call.name === 'get_loan_schemes') {
    if (result.ok) st.schemes = (result.data as { plans: SchemeDisplay[] }).plans;
  } else if (call.name === 'check_existing_application') {
    const mobile = String(args.mobileNumber);
    if (result.ok) {
      const d = result.data as { hasRecentApplication: boolean; applicationId?: string; appliedOn?: string };
      const info: ExistingInfo = { exists: d.hasRecentApplication };
      if (d.applicationId !== undefined) info.applicationId = d.applicationId;
      if (d.appliedOn !== undefined) info.appliedOn = d.appliedOn;
      st.existing.set(mobile, info);
    } else {
      st.existingErrors.set(mobile, result.error);
    }
  } else if (call.name === 'submit_application') {
    const key = payloadKey(args);
    if (result.ok) {
      st.pendingKey = key;
      st.submitErrors.delete(key);
    } else {
      st.submitErrors.set(key, result.error);
    }
  }
}

function derive(messages: LlmRequest['messages']): DState | null {
  let lastUser = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i;
  });
  if (lastUser === -1) return null;

  const st = freshState();
  const runs = new Map<string, Run>();
  let quotePresentedAny = false;

  messages.forEach((m, i) => {
    if (m.role === 'user') {
      const expectingNow = st.expecting;
      const parsed = parseUtterance(m.content, expectingNow, st.applyMode);
      applySlots(st, parsed.slots);
      st.locale = detectLocale(m.content, st.locale);
      const s = parsed.slots;
      if (
        parsed.intents.wantsApply ||
        s.planId ||
        s.name ||
        s.mobileNumber ||
        s.planPreference ||
        (parsed.intents.affirm && quotePresentedAny)
      ) {
        st.applyMode = true;
      }
      if (i === lastUser) {
        st.intents = parsed.intents;
        st.slotsThisTurn = parsed.slots;
        st.expectingAtTurn = expectingNow;
        st.lastUserWords = m.content.trim().split(/\s+/).length;
      }
      st.expecting = null;
    } else if (m.role === 'assistant') {
      if (m.meta?.kind === 'SUBMITTED') {
        resetAfterSubmit(st);
        quotePresentedAny = false;
      } else if (m.meta?.kind === 'CANCELLED') {
        st.pendingKey = null;
      }
      if (m.content.trim()) {
        st.expecting = m.meta?.expecting ?? null;
        const p = m.meta?.presented;
        if (p) {
          st.presented.add(p);
          if (p.startsWith('quote:')) quotePresentedAny = true;
        }
      }
      for (const c of m.toolCalls ?? []) {
        const run: Run = { call: c, result: null };
        runs.set(c.id, run);
        if (i > lastUser) st.runsThisTurn.push(run);
      }
    } else if (m.role === 'tool') {
      const run = runs.get(m.toolCallId ?? '');
      const result = parseResult(m.content);
      if (run) run.result = result;
      absorbToolResult(st, run?.call, result);
    }
  });
  return st;
}

function expectingFor(field: string | undefined): Expecting {
  switch (field) {
    case 'netWeightGrams':
      return 'net';
    case 'grossWeightGrams':
      return 'gross';
    case 'karat':
      return 'karat';
    case 'mobileNumber':
      return 'mobile';
    case 'name':
      return 'name';
    case 'planId':
      return 'plan';
    default:
      return null;
  }
}

function digitsOf(s: string): number {
  return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
}

function pickByPreference(q: QuoteDisplay, pref: 'MAX_LOAN' | 'LOW_INTEREST'): string | undefined {
  const plans = [...q.plans];
  if (plans.length === 0) return undefined;
  plans.sort((a, b) =>
    pref === 'MAX_LOAN' ? digitsOf(b.eligibleLoan) - digitsOf(a.eligibleLoan) : parseFloat(a.interestRate) - parseFloat(b.interestRate),
  );
  return plans[0]!.planId;
}

function decide(st: DState, messageCount: number): LlmResponse {
  const T = templates(st.locale);
  const I = st.intents;
  const turnSlots = hasAnySlot(st.slotsThisTurn);
  const gross = st.grossFollowsNet ? st.net : st.gross;
  let seq = 0;

  const call = (name: string, args: Record<string, unknown>): LlmResponse => ({
    text: null,
    toolCalls: [{ id: `rb_${messageCount}_${++seq}`, name, arguments: args }],
  });
  const reply = (text: string, expecting: Expecting = null, presented?: string): LlmResponse => ({
    text,
    toolCalls: [],
    meta: { expecting, ...(presented ? { presented } : {}) },
  });
  const fix = (err: ToolErr): LlmResponse => {
    const f = err.fields[0];
    return f ? reply(T.fix(f.field, f.message), expectingFor(f.field)) : reply(T.generic(), null);
  };

  /* ── short-circuit intents ── */
  if (I.negate && !turnSlots && (st.pendingKey !== null || st.applyMode)) return reply(T.nothingSubmitted(), null);
  if (I.approvalPromise) return reply(T.approval(), st.expectingAtTurn);
  if (I.investment && !turnSlots) return reply(T.investment(), st.expectingAtTurn);

  if (I.otherLoan && !turnSlots) return reply(T.offTopic(), st.expectingAtTurn);

  const offTopic =
    !I.loanTopic && !turnSlots && !I.affirm && !I.negate && !I.thanks && !I.greet && !I.help && (st.expectingAtTurn === null || st.lastUserWords >= 3);
  if (offTopic) return reply(T.offTopic(), st.expectingAtTurn);

  if (I.thanks && !turnSlots && !I.wantsApply) return reply(T.thanks(), null);
  if (I.help && !turnSlots) return reply(T.help(), null);

  if (I.asksRate && !turnSlots) {
    const latest = [...st.quotes.values()].pop();
    return reply(T.rateInfo(latest?.ratePerGram24k ?? null), st.expectingAtTurn);
  }

  if (I.asksPlans && !turnSlots) {
    if (!st.schemes) return call('get_loan_schemes', {});
    return reply(T.schemes(st.schemes), st.expectingAtTurn, 'schemes');
  }

  const hasEverything = st.net !== undefined || st.karat !== undefined || st.name !== undefined || st.mobile !== undefined;
  if (I.greet && !hasEverything && !st.applyMode) return reply(T.greet(), null);

  /* ── quote flow ── */
  if (st.net === undefined || st.karat === undefined) {
    if (st.net === undefined && st.karat === undefined) return reply(T.askBasics(true, true), 'net');
    return reply(T.askBasics(st.net === undefined, st.karat === undefined), st.net === undefined ? 'net' : 'karat');
  }
  if (gross === undefined) {
    return reply(T.askGross(formatGrams(st.net), st.netWasUnlabeled), st.netWasUnlabeled ? 'weight_confirm' : 'gross');
  }

  const qk = quoteKey(st.net, gross, st.karat);
  const quote = st.quotes.get(qk);
  const quoteErr = st.quoteErrors.get(qk);
  if (!quote && !quoteErr) {
    return call('calculate_quote', { netWeightGrams: st.net, grossWeightGrams: gross, karat: st.karat });
  }
  if (quoteErr) return fix(quoteErr);
  const q = quote!;

  const presentedKey = `quote:${qk}`;
  const quoteNewThisTurn = st.runsThisTurn.some(
    (r) =>
      r.call.name === 'calculate_quote' &&
      r.result?.ok === true &&
      quoteKey(argsOf(r.call).netWeightGrams, argsOf(r.call).grossWeightGrams, argsOf(r.call).karat) === qk,
  );

  if (quoteNewThisTurn) {
    const t = st.slotsThisTurn;
    const applyIntentThisTurn = I.wantsApply || Boolean(t.planId || t.name || t.mobileNumber || t.planPreference);
    const earlierQuote = [...st.presented].some((k) => k.startsWith('quote:'));
    const proceed = st.applyMode && st.pendingKey === null && applyIntentThisTurn && !earlierQuote;
    if (!proceed) {
      return earlierQuote || st.pendingKey !== null
        ? reply(T.requote(q), null, presentedKey)
        : reply(T.quote(q), 'plan', presentedKey);
    }
  }

  if (!st.applyMode) {
    if (!st.presented.has(presentedKey)) return reply(T.quote(q), 'plan', presentedKey);
    return reply(T.askPlan(q.plans.map((p) => p.planName), !st.name, !st.mobile), 'plan');
  }

  /* ── application flow ── */
  const planId = st.planId ?? (st.planPref ? pickByPreference(q, st.planPref) : undefined);
  const needPlan = !planId;
  const needName = !st.name;
  const needMobile = !st.mobile;
  if (needPlan) return reply(T.askPlan(q.plans.map((p) => p.planName), needName, needMobile), 'plan');
  if (needName || needMobile) {
    return reply(T.askContact(needName, needMobile), needName && needMobile ? 'contact' : needName ? 'name' : 'mobile');
  }

  const mobile = st.mobile!;
  const existingErr = st.existingErrors.get(mobile);
  const existing = st.existing.get(mobile);
  if (!existing && !existingErr) return call('check_existing_application', { mobileNumber: mobile });
  if (existingErr) return fix(existingErr);
  if (existing?.exists) {
    return reply(T.duplicateExisting(existing.applicationId ?? '', existing.appliedOn ?? ''), null);
  }

  const payload = {
    name: st.name,
    mobileNumber: mobile,
    grossWeightGrams: gross,
    netWeightGrams: st.net,
    karat: st.karat,
    planId,
  };
  const pk = payloadKey(payload);
  const submitErr = st.submitErrors.get(pk);
  if (submitErr) return fix(submitErr);
  if (st.pendingKey !== pk) return call('submit_application', payload);

  const justPrepared = st.runsThisTurn.some((r) => r.call.name === 'submit_application' && r.result?.ok === true);
  if (!justPrepared && I.affirm) return reply(T.pressConfirm(), null);
  return reply(T.confirmPrompt(), null);
}

export class RuleBasedProvider implements LlmProvider {
  readonly name = 'offline-rules';

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const st = derive(request.messages);
    if (!st) return { text: templates('en').greet(), toolCalls: [], meta: { expecting: null } };
    return decide(st, request.messages.length);
  }
}
