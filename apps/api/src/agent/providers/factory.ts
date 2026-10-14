import type { AppConfig } from '../../config.ts';
import type { LlmProvider } from '../types.ts';
import { AnthropicProvider } from './AnthropicProvider.ts';
import type { FetchLike } from './http.ts';
import { OpenAICompatProvider } from './OpenAICompatProvider.ts';
import { RuleBasedProvider } from './RuleBasedProvider.ts';

export interface ProviderSet {
  /** Used for every turn */
  primary: LlmProvider;
  /** Used for a turn when `primary` is unreachable (undefined when primary already is the offline assistant) */
  fallback: LlmProvider | undefined;
}

/** Picks the LLM backend from configuration. The offline assistant is always the safety net. */
export function createProviders(llm: AppConfig['llm'], fetchImpl?: FetchLike): ProviderSet {
  const offline = new RuleBasedProvider();
  const shared = fetchImpl ? { fetchImpl } : {};

  switch (llm.provider) {
    case 'anthropic':
      return {
        primary: new AnthropicProvider({
          apiKey: llm.apiKey!,
          model: llm.model,
          effort: llm.effort,
          timeoutMs: llm.timeoutMs,
          baseUrl: llm.baseUrl,
          ...shared,
        }),
        fallback: offline,
      };
    case 'openai':
      return {
        primary: new OpenAICompatProvider({
          apiKey: llm.apiKey,
          baseUrl: llm.baseUrl,
          model: llm.model,
          timeoutMs: llm.timeoutMs,
          ...shared,
        }),
        fallback: offline,
      };
    default:
      return { primary: offline, fallback: undefined };
  }
}
