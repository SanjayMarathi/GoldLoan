import { z } from 'zod';

export type LlmProviderName = 'anthropic' | 'openai' | 'offline';

export interface AppConfig {
  port: number;
  env: 'development' | 'test' | 'production';
  logLevel: string;
  webOrigin: string;
  /** Origins allowed to show the app in an iframe (Hugging Face Spaces does this) */
  frameAncestors: string[];
  db: { driver: 'postgres' | 'memory'; url: string | undefined };
  goldRate: { rate24kPaisePerGram: number; cacheTtlMs: number };
  rateLimit: { windowMs: number; leadsMax: number; chatMax: number };
  llm: {
    provider: LlmProviderName;
    anthropicApiKey: string | undefined;
    anthropicModel: string;
    anthropicEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    openaiApiKey: string | undefined;
    openaiBaseUrl: string;
    openaiModel: string;
    timeoutMs: number;
  };
  agent: { maxToolSteps: number; sessionTtlMs: number };
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  FRAME_ANCESTORS: z.string().optional(),
  /** Set automatically by Hugging Face inside a Space */
  SPACE_ID: z.string().optional(),
  DB_DRIVER: z.enum(['auto', 'postgres', 'memory']).default('auto'),
  DATABASE_URL: z.string().optional(),
  MOCK_GOLD_RATE_24K_RUPEES: z.coerce.number().positive().default(7000),
  GOLD_RATE_CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_LEADS_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_CHAT_MAX: z.coerce.number().int().positive().default(40),
  LLM_PROVIDER: z.enum(['auto', 'anthropic', 'openai', 'offline']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AGENT_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(12).default(6),
  AGENT_SESSION_TTL_MS: z.coerce.number().int().positive().default(1_800_000),
});

/** Parse and validate environment variables. Empty strings (e.g. `ANTHROPIC_API_KEY=`) count as unset. */
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

  let provider: LlmProviderName;
  if (e.LLM_PROVIDER === 'auto') {
    provider = e.ANTHROPIC_API_KEY ? 'anthropic' : e.OPENAI_API_KEY ? 'openai' : 'offline';
  } else {
    provider = e.LLM_PROVIDER;
  }
  if (provider === 'anthropic' && !e.ANTHROPIC_API_KEY) throw new Error('LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  if (provider === 'openai' && !e.OPENAI_API_KEY) throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY');

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
    db: { driver: dbDriver, url: e.DATABASE_URL },
    goldRate: {
      rate24kPaisePerGram: Math.round(e.MOCK_GOLD_RATE_24K_RUPEES * 100),
      cacheTtlMs: e.GOLD_RATE_CACHE_TTL_MS,
    },
    rateLimit: { windowMs: e.RATE_LIMIT_WINDOW_MS, leadsMax: e.RATE_LIMIT_LEADS_MAX, chatMax: e.RATE_LIMIT_CHAT_MAX },
    llm: {
      provider,
      anthropicApiKey: e.ANTHROPIC_API_KEY,
      anthropicModel: e.ANTHROPIC_MODEL,
      anthropicEffort: e.ANTHROPIC_EFFORT,
      openaiApiKey: e.OPENAI_API_KEY,
      openaiBaseUrl: e.OPENAI_BASE_URL.replace(/\/+$/, ''),
      openaiModel: e.OPENAI_MODEL,
      timeoutMs: e.LLM_TIMEOUT_MS,
    },
    agent: { maxToolSteps: e.AGENT_MAX_TOOL_STEPS, sessionTtlMs: e.AGENT_SESSION_TTL_MS },
  };
}
