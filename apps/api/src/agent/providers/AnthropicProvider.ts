/**
 * Claude through the official Anthropic SDK (`@anthropic-ai/sdk`, Messages API).
 *
 * Request shape for the current Claude models (Claude Opus 5.5 by default):
 *  • adaptive thinking is always on for these models and `output_config.effort` is the dial. The default is
 *    `low`: this is a chat, replies should be quick, and every number comes from a tool anyway.
 *  • no `temperature` / `top_p`: current models reject sampling parameters with a 400.
 *  • `max_tokens` leaves room for thinking, which counts towards it.
 *  • assistant turns are replayed exactly as the API returned them, thinking blocks included. Thinking blocks
 *    are bound to the conversation that produced them; `prefix_mismatch_behavior: "drop_block"` makes the API
 *    drop (not reject) a block whose history changed, so a chat never fails because of it.
 *  • `fallbacks: "default"` lets the API retry a policy decline on Anthropic's recommended fallback model.
 *  • top-level `cache_control` caches the stable prefix (system prompt + tools + history) between calls.
 */
import Anthropic from '@anthropic-ai/sdk';
import { LlmUnavailableError } from '../types.ts';
import type { ChatMessage, LlmProvider, LlmRequest, LlmResponse, ToolCall } from '../types.ts';
import type { FetchLike } from './http.ts';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Models that accept the server-side `fallbacks: "default"` parameter on the Claude API. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

/** Haiku 4.5 and models before the 4.6 generation take neither adaptive thinking nor `effort`. */
export function supportsAdaptiveThinking(model: string): boolean {
  return !/^claude-(haiku|3)|-4-[015](\b|$)/.test(model);
}

const BETA_FALLBACK = 'server-side-fallback-2026-07-01';
const BETA_THINKING_BINDING = 'thinking-binding-controls-2026-08-01';

/**
 * Our history → the Messages API format. The API wants strictly alternating roles, tool results first in a
 * user turn, and no empty text blocks – so consecutive same-role messages are merged. An assistant turn this
 * provider produced is sent back verbatim (thinking blocks included), never rebuilt from its text.
 */
export function toAnthropicMessages(messages: ChatMessage[], providerName = ''): MessageParam[] {
  const out: Array<{ role: 'user' | 'assistant'; content: ContentBlockParam[] }> = [];
  const push = (role: 'user' | 'assistant', blocks: ContentBlockParam[]): void => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      if (role === 'user') {
        // tool_result blocks must come first in a user turn
        const isResult = (b: ContentBlockParam): boolean => b.type === 'tool_result';
        last.content = [...last.content.filter(isResult), ...blocks.filter(isResult), ...last.content.filter((b) => !isResult(b)), ...blocks.filter((b) => !isResult(b))];
      } else {
        last.content.push(...blocks);
      }
    } else {
      out.push({ role, content: [...blocks] });
    }
  };

  for (const m of messages) {
    if (m.role === 'user') {
      push('user', m.content.trim() ? [{ type: 'text', text: m.content }] : []);
    } else if (m.role === 'assistant') {
      if (providerName && m.providerContent?.provider === providerName) {
        push('assistant', m.providerContent.content as ContentBlockParam[]);
        continue;
      }
      const blocks: ContentBlockParam[] = [];
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments ?? {} });
      push('assistant', blocks);
    } else {
      push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }]);
    }
  }
  return out;
}

/** Read a Messages API response by block type. Refusals and truncated tool calls are never acted on. */
export function parseAnthropicMessage(message: Pick<Anthropic.Beta.BetaMessage, 'content' | 'stop_reason'>, providerName: string): LlmResponse {
  if (!Array.isArray(message?.content)) throw new LlmUnavailableError('Unexpected response from the Anthropic API');
  // A policy decline (after any server-side fallback also declined): no text, no tools – the agent answers safely.
  if (message.stop_reason === 'refusal') return { text: null, toolCalls: [] };

  // Cut off by max_tokens: a tool call may be incomplete, so run nothing and keep nothing for replay.
  const truncated = message.stop_reason === 'max_tokens';
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const block of message.content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use' && !truncated) toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
  }
  return {
    text: text.trim() || null,
    toolCalls,
    ...(truncated ? {} : { providerContent: { provider: providerName, content: message.content as unknown[] } }),
  };
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  effort: AnthropicEffort;
  timeoutMs: number;
  maxTokens?: number;
  baseUrl?: string;
  /** Tests inject a fake transport */
  fetchImpl?: FetchLike;
  maxRetries?: number;
}

export class AnthropicProvider implements LlmProvider {
  readonly name: string;
  private readonly options: AnthropicOptions;
  private readonly client: Anthropic;

  constructor(options: AnthropicOptions) {
    this.options = options;
    this.name = `anthropic:${options.model}`;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries ?? 1,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      ...(options.fetchImpl ? { fetch: options.fetchImpl as unknown as typeof fetch } : {}),
    });
  }

  /** The exact request body sent for `request` (exported for tests). */
  buildParams(request: LlmRequest): CreateParams {
    const { model, effort } = this.options;
    const adaptive = supportsAdaptiveThinking(model);
    const betas: string[] = [];
    if (FALLBACK_MODELS.has(model)) betas.push(BETA_FALLBACK);
    if (adaptive) betas.push(BETA_THINKING_BINDING);

    const params: CreateParams = {
      model,
      max_tokens: this.options.maxTokens ?? 16_000,
      system: request.system,
      messages: toAnthropicMessages(request.messages, this.name),
      cache_control: { type: 'ephemeral' },
    };
    if (request.tools.length > 0) {
      params.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
      }));
      params.tool_choice = request.toolChoice === 'none' ? { type: 'none' } : { type: 'auto' };
    }
    if (adaptive) {
      params.thinking = { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } };
      params.output_config = { effort };
    }
    if (FALLBACK_MODELS.has(model)) params.fallbacks = 'default';
    if (betas.length > 0) params.betas = betas;
    return params;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create(this.buildParams(request));
    } catch (error) {
      // Every failure (bad key, rate limit, outage, timeout, bad request) degrades the chat to the offline
      // assistant instead of breaking it. SDK errors never contain the API key.
      if (error instanceof Anthropic.APIError) {
        const what = error.status ? `HTTP ${error.status}` : 'connection error';
        throw new LlmUnavailableError(`Anthropic API ${what}: ${error.message}`.slice(0, 400), { cause: error });
      }
      throw new LlmUnavailableError(`Anthropic API call failed: ${(error as Error).message}`.slice(0, 400), { cause: error });
    }
    return parseAnthropicMessage(message, this.name);
  }
}
