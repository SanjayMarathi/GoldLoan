import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider, parseAnthropicMessage, supportsAdaptiveThinking, toAnthropicMessages } from '../src/agent/providers/AnthropicProvider.ts';
import { OpenAICompatProvider, parseOpenAiResponse, toOpenAiMessages } from '../src/agent/providers/OpenAICompatProvider.ts';
import { createProviders } from '../src/agent/providers/factory.ts';
import { postJson } from '../src/agent/providers/http.ts';
import type { FetchLike } from '../src/agent/providers/http.ts';
import { RuleBasedProvider } from '../src/agent/providers/RuleBasedProvider.ts';
import { LlmUnavailableError } from '../src/agent/types.ts';
import type { ChatMessage } from '../src/agent/types.ts';
import { loadConfig } from '../src/config.ts';

const history: ChatMessage[] = [
  { role: 'user', content: '45 g net 50 gross 22k' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'calculate_quote', arguments: { netWeightGrams: 45 } }] },
  { role: 'tool', content: '{"ok":true}', toolCallId: 'c1', toolName: 'calculate_quote' },
  { role: 'assistant', content: 'Here you go' },
  { role: 'assistant', content: 'Done! Your application GL-1001 has been submitted', meta: { kind: 'SUBMITTED' } },
  { role: 'user', content: 'thanks' },
];

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Anthropic adapter (official SDK)', () => {
  const blocksOf = (m: { content: unknown }): Array<{ type: string; text?: string }> => m.content as Array<{ type: string; text?: string }>;

  it('merges consecutive assistant messages and puts tool results in a user turn', () => {
    const out = toAnthropicMessages(history);
    assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
    assert.equal(blocksOf(out[1]!)[0]!.type, 'tool_use');
    assert.equal(blocksOf(out[2]!)[0]!.type, 'tool_result');
    assert.equal(blocksOf(out[3]!).length, 2, 'the two assistant texts are merged into one turn');
  });

  it('puts tool_result blocks before text when a user text follows a tool result', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 't', arguments: {} }] },
      { role: 'tool', content: '{}', toolCallId: 'a' },
      { role: 'user', content: 'follow-up' },
    ]);
    assert.deepEqual(blocksOf(out[2]!).map((b) => b.type), ['tool_result', 'text']);
  });

  it('never sends empty text blocks', () => {
    const out = toAnthropicMessages([{ role: 'user', content: 'hi' }, { role: 'assistant', content: '   ' }, { role: 'user', content: 'x' }]);
    assert.equal(out.every((m) => blocksOf(m).every((b) => b.type !== 'text' || (b.text ?? '').trim() !== '')), true);
  });

  it("replays this provider's own turns verbatim, thinking blocks included, and rebuilds other turns", () => {
    const raw = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'tool_use', id: 'tu_1', name: 'calculate_quote', input: { netWeightGrams: 45 } },
    ];
    const messages: ChatMessage[] = [
      { role: 'user', content: '45 g' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tu_1', name: 'calculate_quote', arguments: {} }],
        providerContent: { provider: 'anthropic:claude-opus-5-5', content: raw },
      },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'tu_1' },
    ];
    assert.deepEqual(toAnthropicMessages(messages, 'anthropic:claude-opus-5-5')[1]!.content, raw, 'same model: sent back byte for byte');
    const rebuilt = toAnthropicMessages(messages, 'anthropic:claude-sonnet-5-5')[1]!;
    assert.deepEqual(blocksOf(rebuilt).map((b) => b.type), ['tool_use'], 'another model never receives these thinking blocks');
  });

  it('reads blocks by type, keeps the raw turn for replay, and never runs a refused or truncated turn', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'tu_1', name: 'get_loan_schemes', input: {} },
    ] as never;
    const r = parseAnthropicMessage({ content, stop_reason: 'tool_use' }, 'anthropic:m');
    assert.equal(r.text, 'Let me check.');
    assert.deepEqual(r.toolCalls, [{ id: 'tu_1', name: 'get_loan_schemes', arguments: {} }]);
    assert.equal(r.providerContent?.content.length, 3);

    const refused = parseAnthropicMessage({ content, stop_reason: 'refusal' }, 'anthropic:m');
    assert.deepEqual([refused.text, refused.toolCalls.length, refused.providerContent], [null, 0, undefined]);

    const truncated = parseAnthropicMessage({ content, stop_reason: 'max_tokens' }, 'anthropic:m');
    assert.equal(truncated.toolCalls.length, 0, 'a tool call cut off by max_tokens is never executed');
    assert.equal(truncated.providerContent, undefined);
    assert.throws(() => parseAnthropicMessage({ nope: 1 } as never, 'x'), LlmUnavailableError);
  });

  // Regression: the first version of this adapter (AI-written) sent `temperature: 0.2` and `max_tokens: 700`.
  // Current Claude models reject sampling parameters with a 400, and thinking counts towards max_tokens.
  it('builds a request the current models accept: no sampling params, adaptive thinking, room for thinking', () => {
    const p = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', effort: 'low', timeoutMs: 1000 });
    const params = p.buildParams({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }],
    });
    const body = params as unknown as Record<string, unknown>;
    assert.equal(body.temperature, undefined);
    assert.equal(body.top_p, undefined);
    assert.ok(params.max_tokens >= 8000, 'max_tokens must leave room for thinking');
    assert.deepEqual(params.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
    assert.deepEqual(params.output_config, { effort: 'low' });
    assert.equal(params.fallbacks, 'default');
    assert.deepEqual(params.tool_choice, { type: 'auto' }, 'forced tool_choice (any/tool) is rejected by current models');
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01']);
    assert.equal(supportsAdaptiveThinking('claude-haiku-4-5'), false);
    assert.equal(supportsAdaptiveThinking('claude-sonnet-4-5-20250929'), false);
    assert.equal(supportsAdaptiveThinking('claude-sonnet-5-5'), true);
  });

  it('sends the key in a header (never the body), posts to /v1/messages and honours tool_choice none', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url: String(url), init };
      return json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };
    const p = new AnthropicProvider({ apiKey: 'sk-test-123', model: 'claude-opus-5-5', effort: 'low', timeoutMs: 1000, fetchImpl, maxRetries: 0 });
    const r = await p.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
      toolChoice: 'none',
    });
    assert.equal(r.text, 'hello');
    assert.match(seen!.url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
    const headers = new Headers(seen!.init.headers as ConstructorParameters<typeof Headers>[0]);
    assert.equal(headers.get('x-api-key'), 'sk-test-123');
    assert.match(headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
    const sent = JSON.parse(String(seen!.init.body));
    assert.doesNotMatch(String(seen!.init.body), /sk-test-123/);
    assert.deepEqual(sent.tool_choice, { type: 'none' });
    assert.equal(sent.model, 'claude-opus-5-5');
    assert.equal(sent.betas, undefined, 'betas travel in the header, not the body');
  });

  it('turns API failures into LlmUnavailableError without leaking the key', async () => {
    const fetchImpl: FetchLike = async () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
    const p = new AnthropicProvider({ apiKey: 'sk-secret-999', model: 'claude-opus-5-5', effort: 'low', timeoutMs: 1000, fetchImpl, maxRetries: 0 });
    await assert.rejects(
      p.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] }),
      (e: unknown) => e instanceof LlmUnavailableError && /HTTP 401/.test(e.message) && !/sk-secret-999/.test(e.message),
    );
  });
});

describe('OpenAI-compatible adapter', () => {
  it('maps tool calls and tool results', () => {
    const out = toOpenAiMessages('SYSTEM', history);
    assert.equal(out[0]!.role, 'system');
    const assistantWithCall = out.find((m) => m.tool_calls)!;
    assert.equal(assistantWithCall.content, null);
    assert.equal(assistantWithCall.tool_calls![0]!.function.arguments, '{"netWeightGrams":45}');
    assert.equal(out.find((m) => m.role === 'tool')!.tool_call_id, 'c1');
  });

  it('parses string arguments into objects and survives malformed ones', () => {
    const ok = parseOpenAiResponse({
      choices: [{ message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'calculate_quote', arguments: '{"karat":22}' } }] } }],
    });
    assert.deepEqual(ok.toolCalls[0]!.arguments, { karat: 22 });
    const bad = parseOpenAiResponse({
      choices: [{ message: { content: 'hi', tool_calls: [{ id: 'y', function: { name: 'calculate_quote', arguments: '{oops' } }] } }],
    });
    assert.equal(bad.toolCalls[0]!.arguments, '{oops');
    assert.throws(() => parseOpenAiResponse({}), LlmUnavailableError);
  });

  it('works without an API key (local Ollama) and honours tool_choice none', async () => {
    let body: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      body = JSON.parse(String(init.body));
      headers = init.headers as Record<string, string>;
      return json({ choices: [{ message: { content: 'ok' } }] });
    };
    const p = new OpenAICompatProvider({ apiKey: undefined, baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', timeoutMs: 1000, fetchImpl });
    await p.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], toolChoice: 'none' });
    assert.equal(body.tool_choice, 'none');
    assert.equal(headers.authorization, undefined);
  });
});

describe('postJson', () => {
  it('retries a 429 once and then succeeds', async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => (++n === 1 ? json({ error: 'slow down' }, 429) : json({ ok: true }));
    assert.deepEqual(await postJson({ url: 'http://x', headers: {}, body: {}, timeoutMs: 1000, fetchImpl }), { ok: true });
    assert.equal(n, 2);
  });

  it('does not retry a 401 and never leaks the key into the error', async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      return json({ error: 'invalid key' }, 401);
    };
    await assert.rejects(
      postJson({ url: 'http://x', headers: { 'x-api-key': 'sk-secret' }, body: {}, timeoutMs: 1000, fetchImpl }),
      (e: unknown) => e instanceof LlmUnavailableError && !e.message.includes('sk-secret') && e.message.includes('401'),
    );
    assert.equal(n, 1);
  });

  it('turns a hung request into LlmUnavailableError after the timeout', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await assert.rejects(
      postJson({ url: 'http://x', headers: {}, body: {}, timeoutMs: 30, fetchImpl, retries: 0 }),
      (e: unknown) => e instanceof LlmUnavailableError && /timed out/.test(e.message),
    );
  });
});

describe('provider factory', () => {
  it('uses the offline assistant when there is no key', () => {
    const set = createProviders(loadConfig({}).llm);
    assert.ok(set.primary instanceof RuleBasedProvider);
    assert.equal(set.fallback, undefined);
  });

  it('prefers Anthropic when its key is set and falls back to offline', () => {
    const set = createProviders(loadConfig({ ANTHROPIC_API_KEY: 'k' }).llm);
    assert.equal(set.primary.name, 'anthropic:claude-opus-5-5');
    assert.ok(set.fallback instanceof RuleBasedProvider);
  });

  it('supports any OpenAI-compatible endpoint (Gemini / Ollama)', () => {
    const set = createProviders(loadConfig({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gemini-2.0-flash' }).llm);
    assert.equal(set.primary.name, 'openai-compat:gemini-2.0-flash');
  });

  it('refuses to start with a provider selected but no key', () => {
    assert.throws(() => loadConfig({ LLM_PROVIDER: 'anthropic' }), /ANTHROPIC_API_KEY/);
  });
});
