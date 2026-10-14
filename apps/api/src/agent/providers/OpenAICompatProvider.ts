/**
 * Any OpenAI-compatible Chat Completions endpoint: OpenAI, Google Gemini (OpenAI-compat URL),
 * Ollama / LM Studio / vLLM (local, free) … selected purely by OPENAI_BASE_URL + OPENAI_MODEL.
 */
import { LlmUnavailableError } from '../types.ts';
import type { ChatMessage, LlmProvider, LlmRequest, LlmResponse, ToolCall } from '../types.ts';
import { postJson } from './http.ts';
import type { FetchLike } from './http.ts';

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function toOpenAiMessages(system: string, messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.content.trim()) out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
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

export function parseOpenAiResponse(raw: unknown): LlmResponse {
  const message = (raw as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices?.[0]?.message;
  if (!message) throw new LlmUnavailableError('Unexpected response from the chat-completions API');

  const toolCalls: ToolCall[] = [];
  const rawCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as Array<Record<string, unknown>>) : [];
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
  return { text: text || null, toolCalls };
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
      temperature: 0.2,
      max_tokens: this.options.maxTokens ?? 700,
      messages: toOpenAiMessages(request.system, request.messages),
      tools: request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: request.toolChoice === 'none' ? 'none' : 'auto',
    };

    const raw = await postJson({
      url: `${this.options.baseUrl}/chat/completions`,
      headers: this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {},
      body,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl ?? ((url, init) => fetch(url, init)),
    });
    return parseOpenAiResponse(raw);
  }
}
