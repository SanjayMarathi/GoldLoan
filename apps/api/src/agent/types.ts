/** Provider-neutral conversation types. Every LLM backend is adapted to these. */
import type { ZodType, ZodTypeDef } from 'zod';
import type { FieldError } from '@gold/shared/types';

export type JsonSchema = Record<string, unknown>;

export interface ToolCall {
  id: string;
  name: string;
  /** Raw arguments as produced by the model (validated later with Zod) */
  arguments: unknown;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant messages that ask for tools to be run */
  toolCalls?: ToolCall[];
  /** tool messages: the call they answer */
  toolCallId?: string;
  toolName?: string;
  /** internal annotations – never sent to a real LLM */
  meta?: ChatMessageMeta;
  /** The provider's raw response blocks for this assistant turn, replayed verbatim by that same provider */
  providerContent?: ProviderContent;
}

/** Opaque, provider-specific content (e.g. Claude's thinking + text + tool_use blocks) */
export interface ProviderContent {
  provider: string;
  content: unknown[];
}

export interface ChatMessageMeta {
  kind?: 'SUBMITTED' | 'CANCELLED' | 'GUARD' | 'BLOCKED' | 'DEGRADED';
  /** What the offline assistant just asked for, so a bare "50" can be understood as the answer */
  expecting?: Expecting;
  /** Marks what the offline assistant just showed ("quote:45|50|22", "schemes") so it never repeats itself */
  presented?: string;
}

export type Expecting = 'net' | 'gross' | 'karat' | 'plan' | 'name' | 'mobile' | 'contact' | 'weight_confirm' | null;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface LlmRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** 'none' = the model must answer in text (used for the corrective retry). Default 'auto'. */
  toolChoice?: 'auto' | 'none';
}

export interface LlmResponse {
  text: string | null;
  toolCalls: ToolCall[];
  meta?: ChatMessageMeta;
  /** Set by providers whose turns must be replayed exactly as returned (Claude's thinking blocks) */
  providerContent?: ProviderContent;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Thrown by providers when the model cannot be reached (network, 5xx, timeout, bad key). */
export class LlmUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmUnavailableError';
  }
}

/** What a tool returns to the model (serialised as JSON in the tool message). */
export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; fields: FieldError[] } };

export interface ToolRunOutcome {
  result: ToolResult;
  /** A status chip for the UI ("Calculating quote…") */
  label: string;
  tool: string;
}

export interface ToolExecutor {
  definitions(): ToolDefinition[];
  execute(call: ToolCall, context: ToolContext): Promise<ToolRunOutcome>;
}

export interface ToolContext {
  session: import('./SessionStore.ts').ChatSession;
}

export type ToolArgsSchema<A> = ZodType<A, ZodTypeDef, unknown>;
