/**
 * The agent's tools. Each tool is a small class (open/closed: add a tool = add a class).
 *
 *  • arguments are validated with the SAME Zod schemas the REST API uses;
 *  • an invalid call returns { ok:false, error:{ fields[] } } to the model, which asks the user to fix it;
 *  • every number goes out as a ready-formatted string produced by the server – the model never formats or computes;
 *  • tools call the same QuoteService / LeadService as the REST routes ("same truth, two paths").
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CreateLeadSchema, MobileLookupSchema, QuoteRequestSchema, zodToFieldErrors } from '@gold/shared/schemas';
import type { CreateLeadInput, QuoteRequest } from '@gold/shared/schemas';
import { formatDayMonth } from '@gold/shared/format';
import { maskMobile } from '@gold/shared/mask';
import type { ApplicationSummaryDto } from '@gold/shared/types';
import { AppError } from '../lib/errors.ts';
import type { LeadService } from '../services/LeadService.ts';
import type { QuoteService } from '../services/QuoteService.ts';
import { quoteToDisplay, schemesToDisplay, summaryToDisplay } from './present.ts';
import type {
  JsonSchema,
  ToolArgsSchema,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolExecutor,
  ToolResult,
  ToolRunOutcome,
} from './types.ts';

const ALIASES: Record<string, string> = {
  net: 'netWeightGrams',
  net_weight: 'netWeightGrams',
  net_weight_grams: 'netWeightGrams',
  netWeight: 'netWeightGrams',
  gross: 'grossWeightGrams',
  gross_weight: 'grossWeightGrams',
  gross_weight_grams: 'grossWeightGrams',
  grossWeight: 'grossWeightGrams',
  mobile: 'mobileNumber',
  mobile_number: 'mobileNumber',
  phone: 'mobileNumber',
  plan: 'planId',
  plan_id: 'planId',
};
const NUMERIC_FIELDS = ['netWeightGrams', 'grossWeightGrams', 'karat'];

/** Be liberal in what a model may send (JSON string, aliases, "45" for 45) – strict in what we then validate. */
export function normalizeToolArgs(raw: unknown): unknown {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { __unparseable: true };
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[ALIASES[k] ?? k] = v;
  }
  if (out.payload && typeof out.payload === 'object' && !Array.isArray(out.payload)) {
    for (const [k, v] of Object.entries(out.payload as Record<string, unknown>)) out[ALIASES[k] ?? k] ??= v;
    delete out.payload;
  }
  for (const field of NUMERIC_FIELDS) {
    const v = out[field];
    if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) out[field] = Number(v);
  }
  if (typeof out.mobileNumber === 'number') out.mobileNumber = String(out.mobileNumber);
  return out;
}

export abstract class AgentTool<A> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JsonSchema;
  abstract readonly argsSchema: ToolArgsSchema<A>;
  /** Shown as a status chip in the chat UI while the tool runs */
  abstract readonly statusLabel: string;

  protected abstract run(args: A, context: ToolContext): Promise<unknown>;

  definition(): ToolDefinition {
    return { name: this.name, description: this.description, parameters: this.parameters };
  }

  async execute(rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = this.argsSchema.safeParse(normalizeToolArgs(rawArgs));
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'The tool arguments were invalid. Ask the user to correct only the fields listed.',
          fields: zodToFieldErrors(parsed.error),
        },
      };
    }
    try {
      return { ok: true, data: await this.run(parsed.data, context) };
    } catch (error) {
      if (error instanceof AppError) {
        return { ok: false, error: { code: error.code, message: error.message, fields: error.fields } };
      }
      throw error;
    }
  }
}

/* ───────────────────────── 1. get_loan_schemes ───────────────────────── */

export class GetLoanSchemesTool extends AgentTool<Record<string, never>> {
  readonly name = 'get_loan_schemes';
  readonly description =
    'List the active gold-loan plans (name, interest rate, tenure, maximum LTV, repayment type). You may describe plans ONLY as returned by this tool.';
  readonly parameters: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
  readonly argsSchema = z.object({}) as unknown as ToolArgsSchema<Record<string, never>>;
  readonly statusLabel = 'Fetching loan plans…';
  private readonly quotes: QuoteService;

  constructor(quotes: QuoteService) {
    super();
    this.quotes = quotes;
  }

  protected async run(): Promise<unknown> {
    const schemes = await this.quotes.listSchemes();
    return {
      plans: schemesToDisplay(schemes.map((s) => s.toDto())),
      note: 'The loan amount is never more than 75% of the gold value.',
    };
  }
}

/* ───────────────────────── 2. calculate_quote ───────────────────────── */

export class CalculateQuoteTool extends AgentTool<QuoteRequest> {
  readonly name = 'calculate_quote';
  readonly description =
    'Calculate pure gold, gold value and the eligible loan for every plan. This is the ONLY source of numbers: never calculate anything yourself. Copy the returned strings exactly.';
  readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      netWeightGrams: {
        type: 'number',
        description: 'Net weight of the gold in grams (excluding stones or other material). Greater than 0, at most 3 decimals.',
      },
      grossWeightGrams: {
        type: 'number',
        description: 'Gross (total) weight in grams including stones. Must be at least the net weight and at most 1000.',
      },
      karat: { type: 'integer', enum: [18, 22, 24], description: 'Gold purity in karat: 18, 22 or 24.' },
    },
    required: ['netWeightGrams', 'grossWeightGrams', 'karat'],
    additionalProperties: false,
  };
  readonly argsSchema: ToolArgsSchema<QuoteRequest> = QuoteRequestSchema;
  readonly statusLabel = 'Calculating quote…';
  private readonly quotes: QuoteService;

  constructor(quotes: QuoteService) {
    super();
    this.quotes = quotes;
  }

  protected async run(args: QuoteRequest, context: ToolContext): Promise<unknown> {
    const display = quoteToDisplay(await this.quotes.quote(args));
    const { session } = context;
    session.lastQuoteDisplay = display;
    // The user changed their mind about the gold: a summary card built from the old figures must not stay confirmable.
    const pending = session.pending;
    if (
      pending &&
      (pending.payload.netWeightGrams !== args.netWeightGrams ||
        pending.payload.grossWeightGrams !== args.grossWeightGrams ||
        pending.payload.karat !== args.karat)
    ) {
      session.pending = null;
    }
    return display;
  }
}

/* ───────────────────────── 3. submit_application ───────────────────────── */

export class SubmitApplicationTool extends AgentTool<CreateLeadInput> {
  readonly name = 'submit_application';
  readonly description =
    'Prepare the application and show the user a summary card with Confirm / Cancel buttons. This does NOT submit anything: only the user pressing Confirm files the application. Call it only after the user has chosen a plan and given their name and mobile number.';
  readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: "Applicant's full name: 2-60 characters, letters and spaces only." },
      mobileNumber: { type: 'string', description: '10-digit Indian mobile number starting with 6, 7, 8 or 9 (digits only).' },
      grossWeightGrams: { type: 'number', description: 'Gross weight in grams.' },
      netWeightGrams: { type: 'number', description: 'Net weight in grams (not more than gross).' },
      karat: { type: 'integer', enum: [18, 22, 24] },
      planId: { type: 'string', description: 'A plan id exactly as returned by get_loan_schemes / calculate_quote, e.g. PLAN_EMI_01.' },
    },
    required: ['name', 'mobileNumber', 'grossWeightGrams', 'netWeightGrams', 'karat', 'planId'],
    additionalProperties: false,
  };
  readonly argsSchema: ToolArgsSchema<CreateLeadInput> = CreateLeadSchema;
  readonly statusLabel = 'Preparing your summary…';
  private readonly quotes: QuoteService;

  constructor(quotes: QuoteService) {
    super();
    this.quotes = quotes;
  }

  protected async run(args: CreateLeadInput, context: ToolContext): Promise<unknown> {
    // The summary is computed server-side, exactly as the lead will be when the user confirms.
    const { scheme, quote } = await this.quotes.quoteForPlan(args, args.planId);
    const summary: ApplicationSummaryDto = {
      name: args.name,
      mobileNumberMasked: maskMobile(args.mobileNumber),
      netWeightGrams: args.netWeightGrams,
      grossWeightGrams: args.grossWeightGrams,
      karat: args.karat,
      planId: scheme.id,
      planName: scheme.name,
      repaymentType: scheme.repaymentType,
      interestPercent: scheme.annualInterestBps / 100,
      tenureMonths: scheme.tenureMonths,
      appliedLtvPercent: quote.appliedLtvBps / 100,
      pureGoldMg: quote.pureGoldMg,
      goldValuePaise: quote.goldValuePaise,
      eligibleLoanRupees: quote.eligibleLoanRupees,
      indicative: {
        totalInterestPaise: quote.indicative.totalInterestPaise,
        totalRepayablePaise: quote.indicative.totalRepayablePaise,
        monthlyEmiPaise: quote.indicative.monthlyEmiPaise,
      },
    };
    context.session.pending = { actionId: randomUUID(), payload: args, summary, createdAt: Date.now() };
    return {
      status: 'PENDING_USER_CONFIRMATION',
      instruction:
        'A summary card with Confirm and Cancel buttons is now shown to the user. NOTHING has been submitted. Tell the user to review the card and press Confirm. Never say the application is submitted.',
      summary: summaryToDisplay(summary),
    };
  }
}

/* ───────────────────────── 4. check_existing_application ───────────────────────── */

export class CheckExistingApplicationTool extends AgentTool<{ mobileNumber: string }> {
  readonly name = 'check_existing_application';
  readonly description =
    'Check whether this mobile number already has an application in the last 7 days. Call it once you have the mobile number and before submit_application.';
  readonly parameters: JsonSchema = {
    type: 'object',
    properties: { mobileNumber: { type: 'string', description: '10-digit Indian mobile number (digits only).' } },
    required: ['mobileNumber'],
    additionalProperties: false,
  };
  readonly argsSchema: ToolArgsSchema<{ mobileNumber: string }> = MobileLookupSchema;
  readonly statusLabel = 'Checking existing applications…';
  private readonly leads: LeadService;

  constructor(leads: LeadService) {
    super();
    this.leads = leads;
  }

  protected async run(args: { mobileNumber: string }): Promise<unknown> {
    const recent = await this.leads.findRecentApplication(args.mobileNumber);
    if (!recent) return { hasRecentApplication: false };
    return {
      hasRecentApplication: true,
      applicationId: recent.applicationId,
      appliedOn: formatDayMonth(recent.appliedAt),
      status: recent.status,
      note: 'A new application can be filed 7 days after the existing one.',
    };
  }
}

/* ───────────────────────── registry ───────────────────────── */

export class ToolRegistry implements ToolExecutor {
  private readonly tools = new Map<string, AgentTool<never>>();

  constructor(tools: ReadonlyArray<AgentTool<never>>) {
    for (const tool of tools) this.tools.set(tool.name, tool);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition());
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolRunOutcome> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        tool: call.name,
        label: 'Unknown tool',
        result: { ok: false, error: { code: 'UNKNOWN_TOOL', message: `There is no tool named "${call.name}".`, fields: [] } },
      };
    }
    return { tool: tool.name, label: tool.statusLabel, result: await tool.execute(call.arguments, context) };
  }
}

export function createToolRegistry(deps: { quotes: QuoteService; leads: LeadService }): ToolRegistry {
  return new ToolRegistry([
    new GetLoanSchemesTool(deps.quotes),
    new CalculateQuoteTool(deps.quotes),
    new CheckExistingApplicationTool(deps.leads),
    new SubmitApplicationTool(deps.quotes),
  ] as unknown as ReadonlyArray<AgentTool<never>>);
}
