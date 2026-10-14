/**
 * Localised wording (English + Hinglish in Roman script) for every message the server itself writes:
 * the offline assistant, the confirmation flow, guard fallbacks. All figures are inserted from
 * ready-formatted tool output – nothing here calculates anything.
 */
import type { PlanDisplay, QuoteDisplay, SchemeDisplay } from './present.ts';

export type Locale = 'en' | 'hi';

const HINGLISH_TOKENS =
  /\b(mujhe|mera|meri|mere|kitna|kitne|kitni|chahiye|chahie|karna|karo|kijiye|batao|bataiye|sona|sone|hai|hain|nahi|nahin|haan|aap|aapka|kya|kaise|wajan|vajan|vazan|gehna|zevar|namaste|shukriya|dhanyawad|lena|byaj|abhi|theek|thik|accha|achha|milega|milenge|rupaye|naam|apply karna|pehle|bhai|yaar)\b/i;
const ENGLISH_TOKENS = /\b(the|is|my|how|much|can|i|you|what|please|have|want|to|a|of|and|for|with|apply|loan|gold)\b/gi;

/** Reply in the language of the latest message; short neutral replies ("50", "emi") keep the previous language. */
export function detectLocale(text: string, previous: Locale): Locale {
  if (HINGLISH_TOKENS.test(text)) return 'hi';
  const englishHits = text.match(ENGLISH_TOKENS)?.length ?? 0;
  return englishHits >= 2 ? 'en' : previous;
}

const FIELD_LABELS: Record<string, { en: string; hi: string }> = {
  netWeightGrams: { en: 'net weight', hi: 'net weight' },
  grossWeightGrams: { en: 'gross weight', hi: 'gross weight' },
  karat: { en: 'karat', hi: 'karat' },
  name: { en: 'name', hi: 'naam' },
  mobileNumber: { en: 'mobile number', hi: 'mobile number' },
  planId: { en: 'plan', hi: 'plan' },
};

export function fieldLabel(field: string, locale: Locale): string {
  return FIELD_LABELS[field]?.[locale] ?? field;
}

function planLine(p: PlanDisplay, locale: Locale): string {
  const extra =
    p.monthlyEmi !== null
      ? locale === 'hi'
        ? ` · EMI lagbhag ${p.monthlyEmi}/month`
        : ` · EMI about ${p.monthlyEmi}/month`
      : locale === 'hi'
        ? ` · byaj lagbhag ${p.totalInterest}`
        : ` · interest about ${p.totalInterest}`;
  return locale === 'hi'
    ? `• ${p.planName}: loan ${p.eligibleLoan} tak (${p.interestRate}, ${p.tenureMonths} mahine, gold value ka ${p.appliedLtv})${extra}`
    : `• ${p.planName}: loan up to ${p.eligibleLoan} (${p.interestRate}, ${p.tenureMonths} months, ${p.appliedLtv} of gold value)${extra}`;
}

function schemeLine(s: SchemeDisplay, locale: Locale): string {
  const how =
    s.repaymentType === 'BULLET'
      ? locale === 'hi'
        ? 'byaj + principal maturity par'
        : 'interest + principal paid at maturity'
      : locale === 'hi'
        ? 'har mahine barabar EMI'
        : 'equal monthly instalments';
  return locale === 'hi'
    ? `• ${s.planName}: ${s.interestRate}, gold value ka ${s.maxLtv} tak, ${s.tenureMonths} mahine, ${how}`
    : `• ${s.planName}: ${s.interestRate}, up to ${s.maxLtv} of gold value, ${s.tenureMonths} months, ${how}`;
}

export interface Templates {
  greet(): string;
  help(): string;
  askBasics(needNet: boolean, needKarat: boolean): string;
  askGross(net: string, netWasUnlabeled: boolean): string;
  quote(q: QuoteDisplay): string;
  requote(q: QuoteDisplay): string;
  schemes(list: SchemeDisplay[]): string;
  fix(field: string, message: string): string;
  askPlan(planNames: string[], needName: boolean, needMobile: boolean): string;
  askContact(needName: boolean, needMobile: boolean): string;
  duplicateExisting(applicationId: string, appliedOn: string): string;
  confirmPrompt(): string;
  pressConfirm(): string;
  nothingSubmitted(): string;
  offTopic(): string;
  investment(): string;
  approval(): string;
  thanks(): string;
  rateInfo(rate: string | null): string;
  submitted(applicationId: string, loan: string, planName: string): string;
  cancelled(): string;
  duplicateAtConfirm(applicationId: string, appliedOn: string): string;
  injection(): string;
  llmUnavailable(): string;
  generic(): string;
}

const en: Templates = {
  greet: () =>
    "Hi! I'm your Loan Assist helper. I can estimate how much you can borrow against your gold jewellery and help you apply. Tell me the net weight (in grams) and the karat (18, 22 or 24) of your jewellery to begin.",
  help: () =>
    'I can show our gold loan plans, estimate how much you can borrow for your jewellery, and help you file an application. To start, tell me the net weight in grams and the karat (18, 22 or 24).',
  askBasics: (needNet, needKarat) =>
    needNet && needKarat
      ? 'To estimate your loan I need two things: the net weight of your jewellery in grams (gold only, without stones) and its karat (18, 22 or 24).'
      : needNet
        ? 'What is the net weight of your jewellery in grams (gold only, without stones)?'
        : 'What is the karat of your gold — 18, 22 or 24?',
  askGross: (net, unlabeled) =>
    unlabeled
      ? `Thanks! Is ${net} the net weight (gold only, without stones or other material)? Please also tell me the gross weight (total including stones). If there are no stones, just reply "same".`
      : 'What is the gross weight (total weight including any stones)? If it is the same as the net weight, just reply "same".',
  quote: (q) =>
    [
      `Here's your estimate for ${q.netWeight} of ${q.karat}K gold:`,
      `• Pure gold: ${q.pureGold}`,
      `• Gold value: ${q.goldValue} (24K rate ${q.ratePerGram24k}/g)`,
      '',
      ...q.plans.map((p) => planLine(p, 'en')),
      '',
      q.disclaimer,
      '',
      'Would you like to apply? Tell me the plan you prefer, plus your full name and mobile number.',
    ].join('\n'),
  requote: (q) =>
    [
      `Updated estimate for ${q.netWeight} of ${q.karat}K gold (pure gold ${q.pureGold}, worth ${q.goldValue}):`,
      '',
      ...q.plans.map((p) => planLine(p, 'en')),
      '',
      'Shall I prepare your application with these updated details? (yes / no)',
    ].join('\n'),
  schemes: (list) =>
    [
      'We currently offer these gold loan plans:',
      ...list.map((s) => schemeLine(s, 'en')),
      '',
      "The loan amount never exceeds 75% of your gold's value. Tell me your gold's net weight and karat and I'll work out the exact amounts.",
    ].join('\n'),
  fix: (field, message) =>
    `I couldn't use that — ${message.replace(/\.$/, '')}. Could you tell me the correct ${fieldLabel(field, 'en')}?`,
  askPlan: (names, needName, needMobile) =>
    `Great! Which plan would you like — ${names.join(' or ')}?${
      needName && needMobile
        ? ' Please also share your full name and 10-digit mobile number.'
        : needName
          ? ' Please also share your full name.'
          : needMobile
            ? ' Please also share your 10-digit mobile number.'
            : ''
    }`,
  askContact: (needName, needMobile) =>
    needName && needMobile
      ? 'Please share your full name and your 10-digit mobile number.'
      : needName
        ? 'What is your full name?'
        : 'What is your 10-digit mobile number?',
  duplicateExisting: (id, on) =>
    `This mobile number already has an application (${id}) filed on ${on}. A new application can be made 7 days after that. Is there anything else I can help you with?`,
  confirmPrompt: () =>
    'Please review the summary below and tap Confirm to submit your application. Nothing is submitted until you confirm.',
  pressConfirm: () =>
    "To keep your application safe I can only submit it when you tap the Confirm button on the summary card — typing \"yes\" isn't enough.",
  nothingSubmitted: () => "No problem — nothing has been submitted. Tell me what you'd like to change.",
  offTopic: () =>
    'I can only help with gold loans: estimating how much you can borrow and helping you apply. Tell me the net weight and karat of your gold to get started.',
  investment: () =>
    "I can't give investment advice. What I can do is estimate a loan against gold jewellery you already own — shall we try that?",
  approval: () =>
    "I can't promise approval — the final decision and amount are set after your gold is physically appraised. I can give you an estimate and help you apply.",
  thanks: () => "You're welcome! Is there anything else you'd like to know about gold loans?",
  rateInfo: (rate) =>
    rate
      ? `Estimates use a 24K gold rate of ${rate} per gram. The final value is decided at appraisal.`
      : "I'll show the gold rate used as soon as I calculate an estimate — tell me your jewellery's net weight and karat.",
  submitted: (id, loan, plan) =>
    `Done! Your application ${id} has been submitted (${plan}, estimated loan ${loan}). Our team will review it next — I can't promise approval, and the final amount is confirmed after your gold is appraised. Anything else I can help with?`,
  cancelled: () => "Okay, I've cancelled this application — nothing was submitted. Tell me if you'd like to change anything and try again.",
  duplicateAtConfirm: (id, on) =>
    `You already applied on ${on} (application ${id}), so I couldn't file another one. A new application can be made 7 days after that.`,
  injection: () =>
    "I can't help with that request. I'm here for gold loans only — shall I estimate how much you can borrow against your jewellery?",
  llmUnavailable: () =>
    "Sorry, I'm having trouble reaching my assistant service right now. You can still use the application form, or try again in a moment.",
  generic: () => 'Could you tell me the net weight (in grams) and karat of your gold so I can estimate your loan?',
};

const hi: Templates = {
  greet: () =>
    'Namaste! Main aapka Loan Assist helper hoon. Main bata sakta hoon ki aapke gold jewellery par kitna loan mil sakta hai aur apply karne mein madad kar sakta hoon. Shuru karne ke liye jewellery ka net weight (grams mein) aur karat (18, 22 ya 24) batayiye.',
  help: () =>
    'Main gold loan plans bata sakta hoon, jewellery par loan ka estimate de sakta hoon aur application file karne mein madad kar sakta hoon. Shuru karne ke liye net weight (grams mein) aur karat (18, 22 ya 24) batayiye.',
  askBasics: (needNet, needKarat) =>
    needNet && needKarat
      ? 'Estimate ke liye mujhe do cheezein chahiye: jewellery ka net weight grams mein (sirf sona, stones ke bina) aur karat (18, 22 ya 24).'
      : needNet
        ? 'Jewellery ka net weight kitne grams hai (sirf sona, stones ke bina)?'
        : 'Aapke gold ka karat kya hai — 18, 22 ya 24?',
  askGross: (net, unlabeled) =>
    unlabeled
      ? `Dhanyawad! Kya ${net} net weight hai (sirf sona, stones ke bina)? Gross weight (stones sahit total) bhi batayiye. Agar stones nahi hain to bas "same" likh dijiye.`
      : 'Gross weight (stones sahit total weight) kitna hai? Agar net weight jitna hi hai to bas "same" likh dijiye.',
  quote: (q) =>
    [
      `${q.netWeight} ${q.karat}K gold ka estimate ye raha:`,
      `• Pure gold: ${q.pureGold}`,
      `• Gold value: ${q.goldValue} (24K rate ${q.ratePerGram24k}/g)`,
      '',
      ...q.plans.map((p) => planLine(p, 'hi')),
      '',
      q.disclaimer,
      '',
      'Kya aap apply karna chahenge? Apna pasandida plan, poora naam aur mobile number batayiye.',
    ].join('\n'),
  requote: (q) =>
    [
      `${q.netWeight} ${q.karat}K gold ka naya estimate (pure gold ${q.pureGold}, value ${q.goldValue}):`,
      '',
      ...q.plans.map((p) => planLine(p, 'hi')),
      '',
      'Kya main in naye details ke saath application taiyaar karun? (haan / nahi)',
    ].join('\n'),
  schemes: (list) =>
    [
      'Abhi ye gold loan plans available hain:',
      ...list.map((s) => schemeLine(s, 'hi')),
      '',
      'Loan kabhi bhi gold value ke 75% se zyada nahi hota. Net weight aur karat batayiye, main exact amount nikaal dunga.',
    ].join('\n'),
  fix: (field, message) =>
    `Ye use nahi ho paya — ${message.replace(/\.$/, '')}. Kripya sahi ${fieldLabel(field, 'hi')} batayiye.`,
  askPlan: (names, needName, needMobile) =>
    `Badhiya! Aap kaun sa plan lena chahenge — ${names.join(' ya ')}?${
      needName && needMobile
        ? ' Saath mein apna poora naam aur 10-digit mobile number bhi batayiye.'
        : needName
          ? ' Saath mein apna poora naam bhi batayiye.'
          : needMobile
            ? ' Saath mein apna 10-digit mobile number bhi batayiye.'
            : ''
    }`,
  askContact: (needName, needMobile) =>
    needName && needMobile
      ? 'Kripya apna poora naam aur 10-digit mobile number batayiye.'
      : needName
        ? 'Aapka poora naam kya hai?'
        : 'Aapka 10-digit mobile number kya hai?',
  duplicateExisting: (id, on) =>
    `Is mobile number par ${on} ko pehle se application (${id}) file ho chuki hai. Nayi application uske 7 din baad ki ja sakti hai. Kya main aur kisi cheez mein madad kar sakta hoon?`,
  confirmPrompt: () =>
    'Neeche diya summary dekhiye aur application submit karne ke liye Confirm dabayiye. Jab tak aap confirm nahi karte, kuch submit nahi hota.',
  pressConfirm: () =>
    'Suraksha ke liye main tabhi submit kar sakta hoon jab aap summary card par Confirm button dabayenge — sirf "haan" likhna kaafi nahi hai.',
  nothingSubmitted: () => 'Koi baat nahi — kuch submit nahi hua hai. Batayiye kya badalna hai.',
  offTopic: () =>
    'Main sirf gold loan mein madad kar sakta hoon: kitna loan mil sakta hai ye batana aur apply karwana. Shuru karne ke liye gold ka net weight aur karat batayiye.',
  investment: () =>
    'Main investment advice nahi de sakta. Haan, aapke paas jo gold jewellery hai uske badle loan ka estimate de sakta hoon — kya hum wo try karein?',
  approval: () =>
    'Main approval ka vaada nahi kar sakta — final decision aur amount gold ki physical jaanch ke baad tay hota hai. Main estimate de sakta hoon aur apply karne mein madad kar sakta hoon.',
  thanks: () => 'Aapka swagat hai! Gold loan ke baare mein aur kuch poochna hai?',
  rateInfo: (rate) =>
    rate
      ? `Estimate mein 24K gold rate ${rate} per gram use hota hai. Final value appraisal ke waqt tay hoti hai.`
      : 'Estimate nikalte hi main gold rate bata dunga — jewellery ka net weight aur karat batayiye.',
  submitted: (id, loan, plan) =>
    `Ho gaya! Aapki application ${id} submit ho gayi hai (${plan}, estimated loan ${loan}). Hamari team ise ab review karegi — main approval ka vaada nahi kar sakta, final amount gold ki jaanch ke baad confirm hoga. Aur kuch madad chahiye?`,
  cancelled: () => 'Theek hai, maine application cancel kar di — kuch submit nahi hua. Kuch badalna ho to batayiye, hum phir se try kar sakte hain.',
  duplicateAtConfirm: (id, on) =>
    `Aap ${on} ko pehle hi apply kar chuke hain (application ${id}), isliye dusri application file nahi ho saki. Nayi application uske 7 din baad ki ja sakti hai.`,
  injection: () =>
    'Main is request mein madad nahi kar sakta. Main sirf gold loan ke liye hoon — kya main aapke jewellery par loan ka estimate nikaalun?',
  llmUnavailable: () =>
    'Maaf kijiye, abhi mere assistant service se connect nahi ho pa raha. Aap application form use kar sakte hain ya thodi der baad phir try karein.',
  generic: () => 'Kripya apne gold ka net weight (grams mein) aur karat batayiye taaki main loan estimate nikaal sakoon.',
};

export function templates(locale: Locale): Templates {
  return locale === 'hi' ? hi : en;
}
