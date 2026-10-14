/**
 * GroundingGuard – output check that makes "the LLM never does the maths" enforceable instead of hoped-for.
 *
 * Every rupee amount, gram weight and percentage in a draft reply must be one the assistant was
 * actually given (a tool result, or something the user typed). It also blocks replies that claim an
 * application was submitted when no confirmed submission exists, promise approval, or give investment advice.
 */
import { normalizeNumber } from '../SessionStore.ts';

export interface GroundingReport {
  ok: boolean;
  problems: string[];
}

const MONEY_PREFIX = /(?:₹|\b(?:rs\.?|inr))\s*(\d[\d,]*(?:\.\d+)?)/gi;
const MONEY_SUFFIX = /(\d[\d,]*(?:\.\d+)?)\s*(?:rupees|lakhs?|crores?)\b/gi;
const GRAMS = /(\d+(?:\.\d+)?)\s*(?:g|gm|gms|gram|grams)\b/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s*%/g;
const APPLICATION_ID = /GL-\d+/gi;

const SUBMISSION_CLAIM =
  /\b(has|have|had) (been )?(successfully )?(submitted|filed|registered)\b|\bi(?:'ve| have) (submitted|filed)\b|\bapplication (is|was) (now )?(submitted|filed)\b|\bsuccessfully (submitted|filed)\b|\bapplication (has been|was) (submitted|filed|created)\b/gi;
const APPROVAL_PROMISE =
  /\b(guarantee[ds]?|definitely (be )?approved|will (definitely )?be approved|100% approved|sure to (be )?approved|assured approval)\b/gi;
const INVESTMENT_ADVICE =
  /\b(you should (buy|sell|invest)|good (time|moment|investment) to (buy|sell)|i recommend (buying|selling|investing)|guaranteed returns)\b/gi;
const NEGATION = /\b(no|not|never|nothing|none|n't|cannot|can't|unable|until|yet|without)\b/i;

function negatedBefore(text: string, index: number): boolean {
  return NEGATION.test(text.slice(Math.max(0, index - 30), index));
}

export class GroundingGuard {
  check(reply: string, known: ReadonlySet<string>, options: { submissionConfirmed: boolean }): GroundingReport {
    const problems: string[] = [];

    const figureSets: Array<[string, RegExp]> = [
      ['amount', MONEY_PREFIX],
      ['amount', MONEY_SUFFIX],
      ['weight', GRAMS],
      ['percentage', PERCENT],
    ];
    for (const [kind, pattern] of figureSets) {
      for (const m of reply.matchAll(pattern)) {
        const value = normalizeNumber(m[1]!);
        if (!known.has(value)) problems.push(`the ${kind} "${m[0].trim()}" was not returned by any tool`);
      }
    }

    for (const m of reply.matchAll(APPLICATION_ID)) {
      if (!known.has(m[0].toUpperCase())) problems.push(`the application id "${m[0]}" does not exist`);
    }

    if (!options.submissionConfirmed) {
      for (const m of reply.matchAll(SUBMISSION_CLAIM)) {
        if (!negatedBefore(reply, m.index ?? 0)) problems.push('it claims an application was submitted, but the user has not confirmed one');
      }
    }
    for (const m of reply.matchAll(APPROVAL_PROMISE)) {
      if (!negatedBefore(reply, m.index ?? 0)) problems.push('it promises approval');
    }
    for (const m of reply.matchAll(INVESTMENT_ADVICE)) {
      if (!negatedBefore(reply, m.index ?? 0)) problems.push('it gives investment advice');
    }

    return { ok: problems.length === 0, problems: [...new Set(problems)] };
  }
}
