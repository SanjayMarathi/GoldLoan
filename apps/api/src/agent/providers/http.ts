import { LlmUnavailableError } from '../types.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface PostJsonOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  fetchImpl: FetchLike;
  /** extra attempts after the first one, for 429 / 5xx / network errors / timeouts */
  retries?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST JSON with a hard timeout and one retry on transient failures.
 * Every failure becomes an LlmUnavailableError so the orchestrator can degrade gracefully.
 * Request headers (which carry API keys) are never put into error messages.
 */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const retries = options.retries ?? 1;
  let lastError: LlmUnavailableError = new LlmUnavailableError('LLM request failed');

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await options.fetchImpl(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      });
      if (response.ok) return await response.json();

      const snippet = (await response.text().catch(() => '')).slice(0, 300);
      const error = new LlmUnavailableError(`LLM request failed with HTTP ${response.status}: ${snippet}`);
      if (response.status !== 429 && response.status < 500) throw error; // permanent (bad key, bad request…)
      lastError = error;
    } catch (error) {
      if (error instanceof LlmUnavailableError) throw error;
      const timedOut = controller.signal.aborted;
      lastError = new LlmUnavailableError(
        timedOut ? `LLM request timed out after ${options.timeoutMs} ms` : `LLM network error: ${(error as Error).message}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(300 * 2 ** attempt);
  }
  throw lastError;
}
