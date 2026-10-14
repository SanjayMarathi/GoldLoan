import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { formatGrams, formatGramsFromMg, formatPaise, formatRupees } from '@gold/shared/format';
import type { ApplicationSummaryDto, ChatReplyDto, ChatToolEvent } from '@gold/shared/types';
import { ApiError, api } from '../api/client.ts';
import type { HistoryEntry } from '../hooks/useHistory.ts';
import { newId, readJson, removeKey, writeJson } from '../lib/storage.ts';
import { Icon } from './Icon.tsx';

type CardState = 'open' | 'busy' | 'confirmed' | 'cancelled' | 'closed' | 'replaced';

interface UiMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  events?: ChatToolEvent[];
  card?: { actionId: string; summary: ApplicationSummaryDto; state: CardState };
  error?: boolean;
}

interface Saved {
  sessionId?: string;
  messages: UiMessage[];
  assistant?: string;
}

const STORE_KEY = 'gl-chat-v1';
const MAX_SAVED = 60;
const WELCOME: UiMessage = {
  id: 'welcome',
  role: 'bot',
  text: 'Hi! I’m Loan Assist. I can show our gold loan plans, estimate how much you can borrow and help you apply – just like talking to a loan officer. What would you like to do?',
};
const SUGGESTIONS = ['What loan plans do you have?', 'I have 45 g net, 50 g gross, 22 karat gold', 'Mujhe 10 gram 18 karat par loan chahiye'];

function assistantLabel(provider: string, degraded: boolean): string {
  if (degraded) return 'Offline assistant (AI is busy)';
  if (provider.startsWith('offline')) return 'Offline assistant';
  if (provider.startsWith('anthropic:')) return `Claude · ${provider.slice('anthropic:'.length)}`;
  return provider.split(':')[1] ?? 'AI assistant';
}

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  onFiled: (entry: HistoryEntry) => void;
}

export function ChatPanel({ open, onClose, onFiled }: ChatPanelProps) {
  const saved = useRef<Saved>(readJson<Saved>(STORE_KEY, { messages: [WELCOME] }, 'session'));
  const [messages, setMessages] = useState<UiMessage[]>(() =>
    saved.current.messages.length > 0
      ? saved.current.messages.map((m) => (m.card?.state === 'busy' ? { ...m, card: { ...m.card, state: 'open' as const } } : m))
      : [WELCOME],
  );
  const [sessionId, setSessionId] = useState<string | undefined>(saved.current.sessionId);
  const [assistant, setAssistant] = useState<string | undefined>(saved.current.assistant);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // A closed panel must not be reachable by keyboard or screen reader (set imperatively: works on React 18 and 19).
  useEffect(() => {
    panelRef.current?.toggleAttribute('inert', !open);
  }, [open]);

  useEffect(() => {
    writeJson(STORE_KEY, { sessionId, messages: messages.slice(-MAX_SAVED), assistant }, 'session');
  }, [messages, sessionId, assistant]);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' });
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const addBot = useCallback((reply: ChatReplyDto) => {
    setAssistant(assistantLabel(reply.provider, reply.degraded));
    setSessionId(reply.sessionId);
    setMessages((list) => {
      // an older summary card is stale the moment a newer one appears
      const prior = list.map((m) => (m.card?.state === 'open' && reply.pendingConfirmation ? { ...m, card: { ...m.card, state: 'replaced' as const } } : m));
      return [
        ...prior,
        {
          id: newId(),
          role: 'bot',
          text: reply.reply,
          events: reply.toolEvents,
          ...(reply.pendingConfirmation
            ? { card: { actionId: reply.pendingConfirmation.actionId, summary: reply.pendingConfirmation.summary, state: 'open' as const } }
            : {}),
        },
      ];
    });
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setMessages((l) => [...l, { id: newId(), role: 'user', text }]);
      setInput('');
      setBusy(true);
      try {
        addBot(await api.chat(sessionId, text));
      } catch (error) {
        const message =
          error instanceof ApiError && error.status === 429
            ? 'You’re sending messages very quickly. Please wait a moment and try again.'
            : error instanceof ApiError && error.status === 400
              ? error.fields[0]?.message ?? error.message
              : 'I couldn’t reach the server. Please check your connection and try again.';
        setMessages((l) => [...l, { id: newId(), role: 'bot', text: message, error: true }]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [addBot, busy, sessionId],
  );

  const setCardState = (id: string, state: CardState): void =>
    setMessages((l) => l.map((m) => (m.id === id && m.card ? { ...m, card: { ...m.card, state } } : m)));

  const decide = async (message: UiMessage, decision: 'confirm' | 'cancel'): Promise<void> => {
    if (!message.card || !sessionId || message.card.state !== 'open') return;
    setCardState(message.id, 'busy');
    try {
      const reply = await api.confirm(sessionId, message.card.actionId, decision);
      setCardState(message.id, decision === 'cancel' ? 'cancelled' : reply.submitted ? 'confirmed' : 'closed');
      addBot(reply);
      if (reply.submitted) {
        onFiled({
          applicationId: reply.submitted.applicationId,
          loanRupees: reply.submitted.eligibleLoanRupees,
          planName: message.card.summary.planName,
          at: new Date().toISOString(),
          via: 'chat',
        });
      }
    } catch (error) {
      setCardState(message.id, 'closed');
      const expired = error instanceof ApiError && (error.code === 'SESSION_NOT_FOUND' || error.code === 'ACTION_NOT_FOUND');
      if (error instanceof ApiError && error.code === 'SESSION_NOT_FOUND') setSessionId(undefined);
      setMessages((l) => [
        ...l,
        {
          id: newId(),
          role: 'bot',
          error: true,
          text: expired
            ? 'That summary has expired. Tell me again what you’d like to apply for and I’ll prepare a fresh one.'
            : 'I couldn’t complete that. Nothing was submitted – please try again.',
        },
      ]);
    }
  };

  const reset = (): void => {
    removeKey(STORE_KEY, 'session');
    setMessages([WELCOME]);
    setSessionId(undefined);
    setAssistant(undefined);
    setInput('');
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void send(input);
  };

  return (
    <aside ref={panelRef} className={`chat${open ? ' open' : ''}`} aria-label="Loan Assist chat" aria-hidden={!open}>
      <header className="chat-head">
        <span className="avatar" aria-hidden="true">
          <Icon name="sparkle" size={18} />
        </span>
        <div className="chat-title">
          <b>Loan Assist</b>
          <small>{assistant ?? 'Gold loan helper'}</small>
        </div>
        <button type="button" className="icon-btn" onClick={reset} aria-label="Start a new chat" title="New chat">
          <Icon name="refresh" size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close chat">
          <Icon name="close" size={20} />
        </button>
      </header>

      <div className="chat-log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}${m.error ? ' error' : ''}`}>
            {m.events && m.events.length > 0 && (
              <div className="tool-chips">
                {m.events.map((e, i) => (
                  <span key={i} className={`tool-chip ${e.status}`}>
                    {e.status === 'ok' ? '✓' : '!'} {e.label.replace(/…$/, '')}
                  </span>
                ))}
              </div>
            )}
            <div className="bubble">{m.text}</div>
            {m.card && <ConfirmCard message={m} onDecide={(d) => void decide(m, d)} />}
          </div>
        ))}
        {busy && (
          <div className="msg bot" aria-label="Loan Assist is typing">
            <div className="bubble typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        {messages.length === 1 && !busy && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="suggestion" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message…"
          aria-label="Message"
          enterKeyHint="send"
          autoComplete="off"
          maxLength={1000}
          disabled={busy}
        />
        <button type="submit" className="send" disabled={busy || input.trim() === ''} aria-label="Send message">
          <Icon name="send" size={18} />
        </button>
      </form>
      <p className="chat-foot">Estimates only · never share OTPs or passwords</p>
    </aside>
  );
}

function ConfirmCard({ message, onDecide }: { message: UiMessage; onDecide: (d: 'confirm' | 'cancel') => void }) {
  const card = message.card!;
  const s = card.summary;
  const rows: Array<[string, string]> = [
    ['Name', s.name],
    ['Mobile', s.mobileNumberMasked],
    ['Gold', `${formatGrams(s.netWeightGrams)} net · ${formatGrams(s.grossWeightGrams)} gross · ${s.karat}K`],
    ['Pure gold', formatGramsFromMg(s.pureGoldMg)],
    ['Gold value', formatPaise(s.goldValuePaise)],
    ['Plan', `${s.planName} · ${s.interestPercent}% · ${s.tenureMonths} mo`],
    s.indicative.monthlyEmiPaise !== null
      ? ['Monthly EMI', `${formatPaise(s.indicative.monthlyEmiPaise)} (approx.)`]
      : ['Interest at maturity', `${formatPaise(s.indicative.totalInterestPaise)} (approx.)`],
    ['Total repayable', `${formatPaise(s.indicative.totalRepayablePaise)} (approx.)`],
  ];
  const finished = card.state !== 'open' && card.state !== 'busy';
  return (
    <div className={`confirm-card ${card.state}`}>
      <div className="cc-title">Application summary</div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="total">
          <dt>Eligible loan</dt>
          <dd>{formatRupees(s.eligibleLoanRupees)}</dd>
        </div>
      </dl>
      {finished ? (
        <p className="cc-status">
          {card.state === 'confirmed' ? '✓ Submitted' : card.state === 'cancelled' ? 'Cancelled' : card.state === 'replaced' ? 'Replaced by a newer summary' : 'Closed'}
        </p>
      ) : (
        <div className="cc-actions">
          <button type="button" className="btn btn-ghost btn-small" disabled={card.state === 'busy'} onClick={() => onDecide('cancel')}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-small" disabled={card.state === 'busy'} onClick={() => onDecide('confirm')}>
            {card.state === 'busy' ? 'Submitting…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  );
}
