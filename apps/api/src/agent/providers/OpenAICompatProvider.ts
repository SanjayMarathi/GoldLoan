/**
 * Any OpenAI-compatible Chat Completions endpoint: OpenAI, Google Gemini (OpenAI-compat URL),
 * Ollama / LM Studio / vLLM (local, free) … selected purely by OPENAI_BASE_URL + OPENAI_MODEL.
 *
 *  • No `temperature`: each provider's default is what its models are tuned for (Gemini 3 recommends its default).
 *  • `max_tokens` leaves room for thinking, which reasoning models (Gemini 3, o-series) count towards it.
 *  • An assistant turn this provider produced is replayed with the tool-call fields it returned. Gemini 3 attaches a
 *    `thought_signature` (in `extra_content`) to every function call and rejects the next request with a 400 if
 *    it is missing, so the history must carry it back unchanged.
 */
import { LlmUnavailableError } from '../types.ts';
import type { ChatMessage, LlmProvider, LlmRequest, LlmResponse, ToolCall } from '../types.ts';
import { postJson } from './http.ts';
import type { FetchLike } from './http.ts';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  /** Provider extras, e.g. Gemini's { google: { thought_signature } } */
  extra_content?: unknown;
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  extra_content?: unknown;
}

/** The fields of a returned assistant message that are sent back; anything else (refusal, annotations…) is dropped. */
function replayAssistant(raw: Record<string, unknown>, calls: ToolCall[]): OpenAiMessage {
  const rawCalls = Array.isArray(raw.tool_calls) ? (raw.tool_calls as Array<Record<string, unknown>>) : [];
  const out: OpenAiMessage = { role: 'assistant', content: typeof raw.content === 'string' && raw.content.trim() ? raw.content : null };
  if (rawCalls.length > 0) {
    out.tool_calls = rawCalls.map((c, i) => {
      const fn = (c.function ?? {}) as { name?: unknown; arguments?: unknown };
      return {
        // the id our tool result answers (the orchestrator assigns one when the provider sent none)
        id: calls[i]?.id ?? String(c.id ?? `call_${i}`),
        type: 'function' as const,
        function: { name: String(fn.name ?? ''), arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}) },
        ...(c.extra_content !== undefined ? { extra_content: c.extra_content } : {}),
      };
    });
  }
  if (raw.extra_content !== undefined) out.extra_content = raw.extra_content;
  return out;
}

export function toOpenAiMessages(system: string, messages: ChatMessage[], providerName = ''): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.content.trim()) out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const raw = providerName && m.providerContent?.provider === providerName ? m.providerContent.content[0] : undefined;
      if (raw && typeof raw === 'object') {
        out.push(replayAssistant(raw as Record<string, unknown>, m.toolCalls ?? []));
        continue;
      }
      const calls = m.toolCalls ?? [];
      if (!m.content.trim() && calls.length === 0) continue;
      out.push({
        role: 'assistant',
        content: m.content.trim() ? m.content : null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
    }
  }
  return out;
}

export function parseOpenAiResponse(raw: unknown, providerName = ''): LlmResponse {
  const choice = (raw as { choices?: Array<{ message?: Record<string, unknown>; finish_reason?: unknown }> })?.choices?.[0];
  const message = choice?.message;
  if (!message) throw new LlmUnavailableError('Unexpected response from the chat-completions API');

  // Cut off by the token limit: a tool call may be incomplete, so run nothing and keep nothing for replay.
  const truncated = choice?.finish_reason === 'length';
  const toolCalls: ToolCall[] = [];
  const rawCalls = Array.isArray(message.tool_calls) && !truncated ? (message.tool_calls as Array<Record<string, unknown>>) : [];
  rawCalls.forEach((c, i) => {
    const fn = (c.function ?? {}) as { name?: unknown; arguments?: unknown };
    let args: unknown = fn.arguments;
    if (typeof args === 'string') {
      try {
        args = args.trim() ? JSON.parse(args) : {};
      } catch {
        /* leave the string; normalizeToolArgs flags it and Zod rejects it */
      }
    }
    toolCalls.push({ id: typeof c.id === 'string' && c.id ? c.id : `call_${i}`, name: String(fn.name ?? ''), arguments: args ?? {} });
  });
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  return {
    text: text || null,
    toolCalls,
    ...(providerName && !truncated ? { providerContent: { provider: providerName, content: [message] } } : {}),
  };
}

export interface OpenAICompatOptions {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  maxTokens?: number;
}

export class OpenAICompatProvider implements LlmProvider {
  readonly name: string;
  private readonly options: OpenAICompatOptions;

  constructor(options: OpenAICompatOptions) {
    this.options = options;
    this.name = `openai-compat:${options.model}`;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens ?? 8_000,
      messages: toOpenAiMessages(request.system, request.messages, this.name),
    };
    if (request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = request.toolChoice === 'none' ? 'none' : 'auto';
    }

    const raw = await postJson({
      url: `${this.options.baseUrl}/chat/completions`,
      headers: this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {},
      body,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl ?? ((url, init) => fetch(url, init)),
    });
    return parseOpenAiResponse(raw, this.name);
  }
}
