/**
 * npm run eval            – deterministic: offline assistant, no network, no API key, runs in ~1 s
 * npm run eval -- --live  – same conversations against the LLM configured in .env (tool checks relaxed)
 *
 * Exit code 1 if any scenario fails, so it can gate CI.
 */
import { FakeClock } from '../apps/api/src/lib/clock.ts';
import { createNoopLogger } from '../apps/api/src/lib/noopLogger.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { buildContainer } from '../apps/api/src/container.ts';
import type { Container } from '../apps/api/src/container.ts';
import { loadEnvFiles } from '../apps/api/src/db/loadEnv.ts';
import type { ChatReplyDto } from '@gold/shared/types';
import { SCENARIOS } from './scenarios.ts';
import type { Scenario, Step } from './scenarios.ts';

const live = process.argv.includes('--live');
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const C = { green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m', yellow: '\x1b[33m', reset: '\x1b[0m' };

function makeContainer(): { container: Container; clock: FakeClock } {
  if (live) loadEnvFiles();
  const clock = new FakeClock('2026-10-01T09:00:00.000Z');
  const config = loadConfig(live ? process.env : { LLM_PROVIDER: 'offline', DB_DRIVER: 'memory' });
  return { container: buildContainer(config, { logger: createNoopLogger(), clock }), clock };
}

function checkStep(step: Step, reply: ChatReplyDto): string[] {
  const problems: string[] = [];
  for (const re of step.replyHas ?? []) if (!re.test(reply.reply)) problems.push(`reply should match ${re}`);
  for (const re of step.replyLacks ?? []) if (re.test(reply.reply)) problems.push(`reply must NOT match ${re}`);
  if (step.tools) {
    const used = reply.toolEvents.map((e) => e.tool);
    if (live) {
      for (const t of step.tools) if (!used.includes(t)) problems.push(`expected tool ${t}, used [${used.join(', ')}]`);
    } else if (JSON.stringify(used) !== JSON.stringify(step.tools)) {
      problems.push(`expected tools [${step.tools.join(', ')}], got [${used.join(', ')}]`);
    }
  }
  if (step.card !== undefined && Boolean(reply.pendingConfirmation) !== step.card) {
    problems.push(step.card ? 'a confirmation card should be shown' : 'no confirmation card should be shown');
  }
  if (step.submitted !== undefined && Boolean(reply.submitted) !== step.submitted) {
    problems.push(step.submitted ? 'the application should have been submitted' : 'nothing should have been submitted');
  }
  return problems;
}

async function runScenario(s: Scenario): Promise<{ ok: boolean; log: string[] }> {
  const { container, clock } = makeContainer();
  const log: string[] = [];
  const failures: string[] = [];

  if (s.existingLead) {
    await container.leadService.submit(
      { name: 'Ravi Kumar', mobileNumber: '9876543210', grossWeightGrams: 50, netWeightGrams: 45, karat: 22, planId: 'PLAN_EMI_01' },
      { channel: 'FORM' },
    );
    clock.advanceDays(2);
  }

  let sessionId: string | undefined;
  let lastReply: ChatReplyDto | undefined;

  for (const [i, step] of s.steps.entries()) {
    let reply: ChatReplyDto;
    if (step.press) {
      const action = lastReply?.pendingConfirmation?.actionId;
      if (!action || !sessionId) {
        failures.push(`step ${i + 1}: there was no card to press`);
        break;
      }
      const decision = step.press === 'cancel' ? 'cancel' : 'confirm';
      const presses = step.press === 'confirm-twice' ? 2 : 1;
      const replies = await Promise.all(
        Array.from({ length: presses }, () => container.agent.handleConfirmation(sessionId!, action, decision)),
      );
      reply = replies[0]!;
      log.push(`${C.dim}[${step.press}]${C.reset} → ${reply.reply}`);
    } else {
      reply = await container.agent.handleMessage(sessionId, step.say!);
      sessionId = reply.sessionId;
      log.push(`${C.dim}you:${C.reset} ${step.say}`);
      log.push(`${C.dim}bot${reply.toolEvents.length ? ` [${reply.toolEvents.map((e) => e.tool).join(', ')}]` : ''}:${C.reset} ${reply.reply.replace(/\n+/g, ' ⏎ ')}`);
    }
    lastReply = reply;
    for (const p of checkStep(step, reply)) failures.push(`step ${i + 1}: ${p}`);
  }

  const leads = await container.leadService.list({ page: 1, pageSize: 50 });
  if (leads.total !== s.leadsAtEnd) failures.push(`expected ${s.leadsAtEnd} application(s) at the end, found ${leads.total}`);
  if (s.loanAtEnd !== undefined) {
    const newest = leads.data[0];
    if (newest?.eligibleLoanRupees !== s.loanAtEnd) failures.push(`expected loan ₹${s.loanAtEnd}, got ₹${newest?.eligibleLoanRupees}`);
  }

  for (const f of failures) log.push(`${C.red}✗ ${f}${C.reset}`);
  return { ok: failures.length === 0, log };
}

async function main(): Promise<void> {
  const scenarios = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;
  console.log(`${C.bold}Loan Assist evals${C.reset} – ${live ? 'LIVE model from .env' : 'offline assistant (deterministic)'} – ${scenarios.length} conversations\n`);

  let passed = 0;
  for (const s of scenarios) {
    const { ok, log } = await runScenario(s);
    if (ok) passed += 1;
    const tag = s.covers === 'bonus' ? 'bonus' : `required #${s.covers}`;
    console.log(`${ok ? `${C.green}✓ PASS${C.reset}` : `${C.red}✗ FAIL${C.reset}`}  ${s.id} ${C.dim}(${tag})${C.reset} ${s.title}`);
    if (!ok || verbose) for (const line of log) console.log(`      ${line}`);
  }

  const required = scenarios.filter((s) => s.covers !== 'bonus').length;
  console.log(`\n${passed === scenarios.length ? C.green : C.red}${passed}/${scenarios.length} passed${C.reset} ${C.dim}(${required} required conversations, ${scenarios.length - required} bonus)${C.reset}`);
  process.exit(passed === scenarios.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
