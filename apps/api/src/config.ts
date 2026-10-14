import { z } from 'zod';

export type LlmProviderName = 'anthropic' | 'openai' | 'offline';

export interface AppConfig {
  port: number;
  env: 'development' | 'test' | 'production';
  logLevel: string;
  webOrigin: string;
  /** Origins allowed to show the app in an iframe (Hugging Face Spaces does this) */
  frameAncestors: string[];
  /** Behind a reverse proxy (Hugging Face): read the client IP from X-Forwarded-For for rate limits */
  trustProxy: boolean;
  db: { driver: 'postgres' | 'memory'; url: string | undefined };
  goldRate: { rate24kPaisePerGram: number; cacheTtlMs: number };
  rateLimit: { windowMs: number; leadsMax: number; chatMax: number };
  llm: {
    /** Worked out from LLM_BASE_URL + LLM_API_KEY: api.anthropic.com → anthropic, anything else → openai-compatible */
    provider: LlmProviderName;
    apiKey: string | undefined;
    baseUrl: string;
    model: string;
    /** Claude only: how much the model thinks before answering */
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    timeoutMs: number;
  };
  agent: { maxToolSteps: number; sessionTtlMs: number };
}

/** Google Gemini's OpenAI-compatible endpoint – the free option, and the default. */
export const DEFAULT_LLM_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = { openai: 'gemini-3.5-flash-lite', anthropic: 'claude-opus-5-5' } as const;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'host.docker.internal']);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  FRAME_ANCESTORS: z.string().optional(),
  TRUST_PROXY: z.enum(['true', 'false']).optional(),
  /** Set automatically by Hugging Face inside a Space */
  SPACE_ID: z.string().optional(),
  DB_DRIVER: z.enum(['auto', 'postgres', 'memory']).default('auto'),
  DATABASE_URL: z.string().optional(),
  MOCK_GOLD_RATE_24K_RUPEES: z.coerce.number().positive().default(7000),
  GOLD_RATE_CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_LEADS_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_CHAT_MAX: z.coerce.number().int().positive().default(40),
  /** `offline` forces the built-in assistant (tests, evals); `auto` uses the LLM when a key is set */
  LLM_PROVIDER: z.enum(['auto', 'offline']).default('auto'),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url('LLM_BASE_URL must be a URL, e.g. https://generativelanguage.googleapis.com/v1beta/openai').default(DEFAULT_LLM_BASE_URL),
  LLM_MODEL: z.string().optional(),
  LLM_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AGENT_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(12).default(6),
  AGENT_SESSION_TTL_MS: z.coerce.number().int().positive().default(1_800_000),
});

/** Parse and validate environment variables. Empty strings (e.g. `LLM_API_KEY=`) count as unset. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v.trim() !== '') cleaned[k] = v.trim();
  }

  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration – ${problems}`);
  }
  const e = parsed.data;

  const dbDriver = e.DB_DRIVER === 'auto' ? (e.DATABASE_URL ? 'postgres' : 'memory') : e.DB_DRIVER;
  if (dbDriver === 'postgres' && !e.DATABASE_URL) {
    throw new Error('DB_DRIVER=postgres requires DATABASE_URL to be set');
  }

  // The provider follows from the address: Anthropic's API uses the Claude SDK, everything else speaks the
  // OpenAI-compatible format (Gemini, OpenAI, Groq, Ollama…). No key → the offline assistant, except for a
  // local server such as Ollama, which needs none.
  const base = new URL(e.LLM_BASE_URL);
  const isAnthropic = /(^|\.)anthropic\.com$/i.test(base.hostname);
  const isLocal = LOCAL_HOSTS.has(base.hostname);
  const kind = isAnthropic ? 'anthropic' : 'openai';
  const provider: LlmProviderName = e.LLM_PROVIDER === 'offline' || (!e.LLM_API_KEY && !isLocal) ? 'offline' : kind;
  // the Anthropic SDK adds /v1/messages itself
  const baseUrl = isAnthropic ? `${base.origin}` : e.LLM_BASE_URL.replace(/\/+$/, '');

  return {
    port: e.PORT,
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    webOrigin: e.WEB_ORIGIN,
    frameAncestors: e.FRAME_ANCESTORS
      ? e.FRAME_ANCESTORS.split(',').map((o) => o.trim()).filter(Boolean)
      : e.SPACE_ID
        ? ['https://huggingface.co', 'https://*.hf.space']
        : [],
    trustProxy: e.TRUST_PROXY ? e.TRUST_PROXY === 'true' : Boolean(e.SPACE_ID),
    db: { driver: dbDriver, url: e.DATABASE_URL },
    goldRate: {
      rate24kPaisePerGram: Math.round(e.MOCK_GOLD_RATE_24K_RUPEES * 100),
      cacheTtlMs: e.GOLD_RATE_CACHE_TTL_MS,
    },
    rateLimit: { windowMs: e.RATE_LIMIT_WINDOW_MS, leadsMax: e.RATE_LIMIT_LEADS_MAX, chatMax: e.RATE_LIMIT_CHAT_MAX },
    llm: {
      provider,
      apiKey: e.LLM_API_KEY,
      baseUrl,
      model: e.LLM_MODEL ?? DEFAULT_MODEL[kind],
      effort: e.LLM_EFFORT,
      timeoutMs: e.LLM_TIMEOUT_MS,
    },
    agent: { maxToolSteps: e.AGENT_MAX_TOOL_STEPS, sessionTtlMs: e.AGENT_SESSION_TTL_MS },
  };
}
