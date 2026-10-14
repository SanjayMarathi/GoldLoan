/**
 * Small rule-based language understanding (English + Hinglish) used by the offline assistant.
 * Pure functions, no dependencies. It extracts "slots" (weights, karat, name, mobile, plan)
 * and coarse intents from one user utterance, using what the assistant just asked (`expecting`)
 * to interpret bare replies such as "50" or "emi".
 */
import { PLAN_BULLET_ID, PLAN_EMI_ID } from '@gold/shared/constants';
import type { Expecting } from './types.ts';

export interface ParsedSlots {
  netWeightGrams?: number;
  grossWeightGrams?: number;
  karat?: number;
  name?: string;
  mobileNumber?: string;
  planId?: string;
  planPreference?: 'MAX_LOAN' | 'LOW_INTEREST';
  /** "same" / "no stones": gross weight equals net weight */
  grossSameAsNet?: boolean;
  /** The net weight came from an unlabeled number ("45 grams of jewellery") so it still needs confirming */
  netWasUnlabeled?: boolean;
}

export interface Intents {
  greet: boolean;
  thanks: boolean;
  help: boolean;
  asksPlans: boolean;
  asksRate: boolean;
  wantsApply: boolean;
  affirm: boolean;
  negate: boolean;
  investment: boolean;
  approvalPromise: boolean;
  loanTopic: boolean;
  /** Asks about a different product (home / car / personal … loan) and never mentions gold */
  otherLoan: boolean;
  isQuestion: boolean;
}

export interface Parsed {
  slots: ParsedSlots;
  intents: Intents;
}

/* ───────────────────────── helpers ───────────────────────── */

const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(?:grams?|gms?|gm|grm|gr|g)\b/g;
const GROSS_BEFORE = /(gross|total|kul|with\s+(?:stones?|moti|nag))\b[^\d]{0,18}$/;
const NET_BEFORE = /(net|pure|without\s+(?:stones?|moti|nag)|excluding|only\s+gold|sirf\s+sona)\b[^\d]{0,18}$/;
const AFTER_LABEL = /^\s*[(-]?\s*(net|pure|gross|total)\b/;
const UNITLESS_LABELED = /\b(net|gross)\b(?:\s+(?:weight|wt))?\s*(?:is|=|:|-)?\s*(\d{1,4}(?:\.\d+)?)(?![\d.]|\s*(?:k|kt|karat|carat)\b)/g;
const SAME_RE =/\b(same|no stones?|without stones?|stones? (?:nahi|nahin|illa)|nahi hai|nahin hai|only gold|equal|barabar|wahi)\b/;
const KARAT_RE = /(?<![\d.])(\d{1,2})\s*(?:k|kt|kts|karat|karats|carat|carats|caret)\b/;
const KARAT_RE_2 = /\b(?:karat|carat|caret|kt)\s*(?:is|=|:|of)?\s*(\d{1,2})\b/;

const NAME_STOP_FIRST = new Set(
  (
    'interested looking here ready fine ok okay sure trying planning applying thinking wondering asking from in not having ' +
    'holding with a an the getting confused new going wanting want need just also glad happy calling writing using owner ' +
    'aware good well so very still now at on to for interest curious keen eager sorry thankful unsure confirming checking ' +
    'applying wanting hoping'
  ).split(' '),
);
const NAME_LOOKAHEAD =
  '(?=\\s*(?:,|\\.|!|\\?|;|$|\\band\\b|\\baur\\b|\\bmy\\b|\\bmobile\\b|\\bphone\\b|\\bnumber\\b|\\bcontact\\b|\\bnum\\b|\\bhai\\b|\\bhoon\\b|\\bplan\\b|\\bemi\\b|\\bbullet\\b|\\d))';
const NAME_EXPLICIT = new RegExp(`(?:my name is|name is|mera naam|mera name|naam hai|naam)\\s+([a-z][a-z .']{1,58}?)${NAME_LOOKAHEAD}`, 'i');
const NAME_IAM = new RegExp(`(?:\\bi am|\\bi'm|\\bim|\\bthis is|\\bmain)\\s+([a-z][a-z ]{1,58}?)${NAME_LOOKAHEAD}`, 'i');
const RESIDUAL_STOP =
  /\b(emi|bullet|plan|repayment|monthly|instal+ments?|my|name|is|and|number|mobile|phone|contact|hi|hello|hey|please|the|apply|with|for|i|am|im|naam|mera|hai|aur|ka|ki|ke|main|yes|ok|okay|sure|haan|go|ahead|proceed|take|choose|want|pick|select|prefer|opt|lena|chahiye|no|stones?|same|loan|karna|karo|us|this|that|one|to|a|an)\b/gi;

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function cleanName(candidate: string): string {
  return titleCase(candidate.replace(/\s+(?:and|aur|my|is|hai|hoon)$/i, '').replace(/\s+/g, ' ').trim());
}

function lastKeywordPos(haystack: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source.replace(/\[\^\\d\]\{0,18\}\$$/, ''), flags);
  let pos = -1;
  for (const m of haystack.matchAll(re)) pos = m.index ?? pos;
  return pos;
}

interface FoundWeight {
  value: number;
  label: 'net' | 'gross' | null;
  start: number;
  end: number;
  /** End of a trailing label ("45 g net") so the NEXT weight cannot reuse that word as its own label */
  consumedEnd: number;
}

function labelBefore(before: string): 'net' | 'gross' | null {
  const g = GROSS_BEFORE.test(before);
  const n = NET_BEFORE.test(before);
  if (g && n) return lastKeywordPos(before, GROSS_BEFORE) > lastKeywordPos(before, NET_BEFORE) ? 'gross' : 'net';
  return g ? 'gross' : n ? 'net' : null;
}

function labelAfter(after: string): { label: 'net' | 'gross'; length: number } | null {
  const m = AFTER_LABEL.exec(after);
  if (!m) return null;
  return { label: m[1] === 'net' || m[1] === 'pure' ? 'net' : 'gross', length: m[0].length };
}

function parseWeights(t: string, expecting: Expecting): Pick<ParsedSlots, 'netWeightGrams' | 'grossWeightGrams' | 'netWasUnlabeled'> {
  const found: FoundWeight[] = [];
  for (const m of t.matchAll(WEIGHT_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    found.push({ value: parseFloat(m[1]!), label: null, start, end, consumedEnd: end });
  }
  found.forEach((w, i) => {
    const prevEnd = i > 0 ? found[i - 1]!.consumedEnd : 0;
    const before = t.slice(Math.max(prevEnd, w.start - 30), w.start);
    const labelB = labelBefore(before);
    if (labelB) {
      w.label = labelB;
      return;
    }
    const labelA = labelAfter(t.slice(w.end, w.end + 14));
    if (labelA) {
      w.label = labelA.label;
      w.consumedEnd = w.end + labelA.length;
    }
  });

  let net: number | undefined;
  let gross: number | undefined;
  let netWasUnlabeled = false;
  for (const w of found) {
    if (w.label === 'net') net = w.value;
    if (w.label === 'gross') gross = w.value;
  }
  // "net 55, gross 60" – labelled numbers without a unit
  for (const m of t.matchAll(UNITLESS_LABELED)) {
    const value = parseFloat(m[2]!);
    if (m[1] === 'net' && net === undefined) net = value;
    if (m[1] === 'gross' && gross === undefined) gross = value;
  }
  const unlabeled = found.filter((w) => w.label === null);

  if (unlabeled.length > 0) {
    if ((expecting === 'gross' || expecting === 'weight_confirm') && gross === undefined) {
      gross = unlabeled[unlabeled.length - 1]!.value;
    } else if (expecting === 'net' && net === undefined) {
      net = unlabeled[unlabeled.length - 1]!.value;
    } else if (net === undefined && gross === undefined) {
      if (unlabeled.length >= 2) {
        const a = unlabeled[0]!.value;
        const b = unlabeled[1]!.value;
        net = Math.min(a, b);
        gross = Math.max(a, b);
      } else {
        net = unlabeled[0]!.value;
        netWasUnlabeled = true;
      }
    } else if (net === undefined) {
      net = unlabeled[0]!.value;
    } else if (gross === undefined) {
      gross = unlabeled[0]!.value;
    }
  }

  // A bare number ("50") answering "what is the gross weight?"
  if (found.length === 0 && (expecting === 'net' || expecting === 'gross' || expecting === 'weight_confirm')) {
    const withoutKarat = t.replace(KARAT_RE, ' ').replace(KARAT_RE_2, ' '); // "22 karat" is not a weight
    const bare = /(?<![\d.])(\d{1,4}(?:\.\d+)?)(?![\d.])/.exec(withoutKarat);
    if (bare && t.split(' ').length <= 6) {
      const v = parseFloat(bare[1]!);
      if (expecting === 'net') net = v;
      else gross = v;
    }
  }

  const out: Pick<ParsedSlots, 'netWeightGrams' | 'grossWeightGrams' | 'netWasUnlabeled'> = {};
  if (net !== undefined) out.netWeightGrams = net;
  if (gross !== undefined) out.grossWeightGrams = gross;
  if (netWasUnlabeled) out.netWasUnlabeled = true;
  return out;
}

function parseKarat(t: string, expecting: Expecting): number | undefined {
  const m = KARAT_RE.exec(t) ?? KARAT_RE_2.exec(t);
  if (m) return parseInt(m[1]!, 10);
  if (expecting === 'karat' && !t.match(WEIGHT_RE)) {
    const bare = /(?<![\d.])(\d{1,2})(?![\d.])/.exec(t);
    if (bare) return parseInt(bare[1]!, 10);
  }
  return undefined;
}

function parseMobile(text: string, expecting: Expecting): string | undefined {
  const cleaned = text.replace(/\+?91[\s-]?(?=[6-9]\d{4}[\s-]?\d{5}(?!\d))/, '');
  const spaced = /(?<!\d)([6-9]\d{4})[\s-]?(\d{5})(?!\d)/.exec(cleaned);
  if (spaced) return `${spaced[1]}${spaced[2]}`;

  const runs = [...cleaned.matchAll(/(?<![\d.])\d{5,13}(?![\d.])/g)].map((m) => m[0]);
  if (runs.length === 0) return undefined;
  const long = runs.find((r) => r.length >= 10);
  if (long) {
    if (long.length === 12 && long.startsWith('91')) return long.slice(2);
    if (long.length === 11 && long.startsWith('0')) return long.slice(1);
    return long;
  }
  const labeled = /(mobile|phone|number|contact|whatsapp|mob|num)\b[^\d]{0,12}\d{5,13}/i.test(cleaned);
  if (labeled || expecting === 'mobile' || expecting === 'contact') return runs[0];
  return undefined;
}

function residualName(text: string): string | undefined {
  let s = text.replace(/\+?\d[\d\s-]{4,}\d/g, ' ');
  s = s.replace(RESIDUAL_STOP, ' ');
  s = s.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 2) return undefined;
  const words = s.split(' ');
  if (words.length > 4) return undefined;
  return titleCase(s);
}

function parseName(text: string, expecting: Expecting, hasMobile: boolean, isYesNo: boolean): string | undefined {
  const explicit = NAME_EXPLICIT.exec(text);
  if (explicit) return cleanName(explicit[1]!);

  const iam = NAME_IAM.exec(text);
  if (iam) {
    const first = iam[1]!.trim().split(/\s+/)[0]!.toLowerCase();
    const words = iam[1]!.trim().split(/\s+/);
    if (!NAME_STOP_FIRST.has(first) && words.length <= 5) return cleanName(iam[1]!);
  }

  if ((expecting === 'name' || expecting === 'contact') && !isYesNo) {
    const candidate = text.replace(/[.!?,\s]+$/, '').trim();
    if (!hasMobile && candidate.length > 0 && candidate.length <= 60) {
      // Pass odd input through unchanged so the tool's Zod validation can reject it and the user is asked again
      return /^[\p{L}\p{M} ]+$/u.test(candidate) ? titleCase(candidate) : candidate;
    }
    return residualName(text);
  }
  if (expecting === 'plan' && !isYesNo) {
    return hasMobile ? residualName(text) : undefined;
  }
  return undefined;
}

/* ───────────────────────── public API ───────────────────────── */

export function parseUtterance(raw: string, expecting: Expecting, applyMode: boolean): Parsed {
  const text = raw.replace(/\s+/g, ' ').trim();
  const t = text.toLowerCase();

  const intents: Intents = {
    greet: /^(hi+|hello+|hey+|hii+|namaste|namaskar|good (morning|afternoon|evening)|hola)\b/.test(t),
    thanks: /\b(thanks|thank you|thankyou|thx|dhanyawad|shukriya)\b/.test(t),
    help: /\b(help|what can you do|how does this work|how do you work|kya kar sakte|madad)\b/.test(t),
    asksPlans: false,
    asksRate: /\b(gold rate|rate of gold|today'?s? (gold )?rate|per gram rate|rate per gram|aaj ka rate|sone ka (rate|bhav)|gold price|price of gold)\b/.test(t),
    wantsApply:
      /\b(apply|proceed|go ahead|submit|file (it|an? application|my application)|continue|start (the )?application|aage badho|apply karna|apply karo|apply kar|application bhar|i (want|need) (a |the )?loan|take (the )?loan|loan lena|loan chahiye)\b/.test(
        t,
      ),
    affirm:
      /^(y|yes|yeah|yep|yup|ok|okay|sure|haan|ha|han|haa|ji|ji haan|theek hai|thik hai|correct|right|please do|do it|go ahead|proceed|confirm|yes please|sounds good|alright)\b/.test(
        t,
      ),
    negate: /^(no|nope|nah|nahi|nahin|cancel|stop|not now|abort|never mind|rehne do|mat karo)\b/.test(t),
    investment:
      /\b(invest(ment|ing|or)?|should i (buy|sell)|buy gold|sell (my )?gold|stocks?|crypto|bitcoin|mutual funds?|share market|trading|etf|sip)\b/.test(
        t,
      ),
    approvalPromise:
      /\b(guarantee[d]?|sure(ly)? (be )?approved|will (it|my loan|the loan) (be )?approved?|definitely approved|approval (chance|guarantee)|pakka (approve|milega)|approve ho)\b/.test(
        t,
      ),
    loanTopic:
      /(gold|sona|sone|loan|karat|carat|\bkt\b|\d\s*k\b|gram|jewel|ornament|emi|interest|apply|application|mobile|plan|scheme|weight|quote|eligible|ltv|bullet|pledge|zevar|gehna|lend|borrow|rupee|₹|status|approv|appraisal|byaj|paisa|rate|tenure|stone)/.test(
        t,
      ),
    otherLoan:
      /\b(home|house|housing|car|auto|vehicle|bike|two[- ]wheeler|personal|education|student|business|mortgage|property|payday|credit card|crop|farm|agri(culture)?)\s+loans?\b/.test(t) &&
      !/\b(gold|sona|sone|jewel(l)?ery|zevar|gehna|ornaments?)\b/.test(t),
    isQuestion: /\?|^(what|how|which|tell|explain|difference|compare|kya|kaise|kaun|batao|can|do|does|is|are)\b/.test(t),
  };

  const slots: ParsedSlots = {};
  Object.assign(slots, parseWeights(t, expecting));

  const karat = parseKarat(t, expecting);
  if (karat !== undefined) slots.karat = karat;

  const saysNoStones = /\b(no stones?|without (any )?stones?|stones? (nahi|nahin))\b/.test(t);
  if (
    slots.grossWeightGrams === undefined &&
    (((expecting === 'gross' || expecting === 'weight_confirm' || /\bgross\b/.test(t)) && SAME_RE.test(t)) || saysNoStones)
  ) {
    slots.grossSameAsNet = true;
  }

  const mobile = parseMobile(text, expecting);
  if (mobile !== undefined) slots.mobileNumber = mobile;

  const isYesNo = intents.affirm || intents.negate;
  const name = parseName(text, expecting, mobile !== undefined, isYesNo);
  if (name !== undefined) slots.name = name;

  // Plan choice
  const emi = /\b(emi|e\.m\.i\.?|monthly\s+(instal+ments?|payments?|emi))\b/.test(t);
  const bullet = /\b(bullet|lump\s?sum|at\s+maturity|end\s+of\s+(the\s+)?tenure)\b/.test(t);
  const selecting = /\b(go with|choose|select|take|prefer|want|opt|pick|going for|lena|chahiye|chunna|pasand|with|for|plan)\b/.test(t);
  const shortReply = t.split(' ').length <= 4;
  const questionLike = intents.isQuestion && expecting !== 'plan';
  if (emi !== bullet && !questionLike && (expecting === 'plan' || expecting === 'contact' || selecting || shortReply || applyMode)) {
    slots.planId = emi ? PLAN_EMI_ID : PLAN_BULLET_ID;
  }
  if (!questionLike && slots.planId === undefined) {
    if (/\b(highest|maximum|max|most|more money|zyada|jyada|bigger|larger)\b/.test(t) && /\b(loan|amount|money|paisa|plan|option)\b/.test(t)) {
      slots.planPreference = 'MAX_LOAN';
    } else if (/\b(lowest|cheapest|least interest|kam byaj|low interest|lower interest|minimum interest)\b/.test(t)) {
      slots.planPreference = 'LOW_INTEREST';
    }
  }

  const hasSlots = Object.keys(slots).length > 0;
  intents.asksPlans =
    /\b(plans?|schemes?|options|interest rates?|rate of interest|byaj|tenure|ltv|bullet|emi|repayment)\b/.test(t) &&
    (intents.isQuestion || !hasSlots) &&
    !(expecting === 'plan' && slots.planId !== undefined);

  return { slots, intents };
}

export function hasAnySlot(slots: ParsedSlots): boolean {
  return Object.keys(slots).length > 0;
}
