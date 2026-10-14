/**
 * InputGuard – first line of defence against prompt injection. Runs BEFORE any LLM call.
 * (The real protections are structural – tools validate everything and the server enforces the
 * confirmation step – this just stops obvious attacks cheaply and keeps them out of the history.)
 */

const MAX_LENGTH = 1000;

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass|skip)\b[^.]{0,40}\b(previous|prior|above|earlier|all|any|your|the|these|those)\b[^.]{0,30}\b(instructions?|rules?|prompts?|guardrails?|guidelines?|polic(y|ies)|restrictions?)\b/i,
  /\b(reveal|show|print|repeat|display|leak|share|output|tell me)\b[^.]{0,30}\b(system|hidden|initial|original|developer)\b[^.]{0,15}\b(prompt|instructions?|message|rules?)\b/i,
  /\byou are now\b/i,
  /\b(act|behave|respond) as (?!a (customer|borrower|user)\b)/i,
  /\bpretend (to be|you are|you're)\b/i,
  /\b(developer|dev|god|jailbreak|dan|admin|sudo|root) mode\b/i,
  /\bjailbreak\b/i,
  /\bnew (instructions?|rules?|persona)\b/i,
  /^\s*(system|assistant|developer)\s*:/im,
  /<\|?(im_start|im_end|system|endoftext)\|?>/i,
  /\[\/?(INST|SYS)\]/i,
  /\boverride\b[^.]{0,30}\b(ltv|limit|cap|75)/i,
  /\bset\b[^.]{0,20}\b(the )?(ltv|loan amount|interest( rate)?)\b[^.]{0,20}\bto\b/i,
  /\bapprove\b[^.]{0,40}\bloan\b[^.]{0,40}\b(without|regardless|anyway|bypass)/i,
  // Hinglish
  /\b(pichle|purane|upar ke)\b[^.]{0,20}\b(instructions?|niyam|rules?)\b[^.]{0,20}\b(ignore|bhool|mat maano)/i,
  /\bignore karo\b/i,
];

export type InputVerdict = { ok: true; text: string } | { ok: false; reason: 'EMPTY' | 'INJECTION' };

export class InputGuard {
  /** Normalise (NFKC, strip invisible/control characters, collapse spaces) and screen the message. */
  inspect(raw: string): InputVerdict {
    const text = this.sanitize(raw);
    if (text.length === 0) return { ok: false, reason: 'EMPTY' };
    if (INJECTION_PATTERNS.some((p) => p.test(text))) return { ok: false, reason: 'INJECTION' };
    return { ok: true, text };
  }

  sanitize(raw: string): string {
    return raw
      .normalize('NFKC')
      .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_LENGTH);
  }
}
