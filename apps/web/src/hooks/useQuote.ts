import { useEffect, useState } from 'react';
import { QuoteRequestSchema } from '@gold/shared/schemas';
import type { QuoteResponse } from '@gold/shared/types';
import { api, isAbort } from '../api/client.ts';

export interface QuoteInput {
  net: number | null;
  gross: number | null;
  karat: number | null;
}

export type QuoteState =
  | { status: 'idle' }
  | { status: 'loading'; data?: QuoteResponse }
  | { status: 'ready'; data: QuoteResponse }
  | { status: 'error'; message: string; data?: QuoteResponse };

const DEBOUNCE_MS = 300;
/** Tiny in-memory cache: toggling back to a value you already tried is instant and costs no request. */
const cache = new Map<string, QuoteResponse>();
const CACHE_MAX = 30;

function remember(key: string, value: QuoteResponse): void {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/**
 * Live quote while the user types:
 *  • nothing is sent until the input is valid (same Zod schema the server uses),
 *  • calls are debounced by 300 ms, an older in-flight request is aborted,
 *  • the previous result stays visible (dimmed) while the next one loads, so the UI never flickers.
 */
export function useQuote({ net, gross, karat }: QuoteInput): QuoteState {
  const [state, setState] = useState<QuoteState>({ status: 'idle' });

  useEffect(() => {
    const parsed = QuoteRequestSchema.safeParse({ netWeightGrams: net, grossWeightGrams: gross, karat });
    if (!parsed.success) {
      setState({ status: 'idle' });
      return;
    }
    const key = `${net}|${gross}|${karat}`;
    const hit = cache.get(key);
    if (hit) {
      setState({ status: 'ready', data: hit });
      return;
    }

    const controller = new AbortController();
    setState((s) => ({ status: 'loading', ...(s.status === 'idle' || !('data' in s) || !s.data ? {} : { data: s.data }) }));
    const timer = window.setTimeout(async () => {
      try {
        const data = await api.quote(parsed.data, controller.signal);
        remember(key, data);
        setState({ status: 'ready', data });
      } catch (error) {
        if (isAbort(error)) return;
        setState((s) => ({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not calculate the estimate.',
          ...('data' in s && s.data ? { data: s.data } : {}),
        }));
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [net, gross, karat]);

  return state;
}
