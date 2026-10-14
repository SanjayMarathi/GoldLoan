/**
 * End-to-end over real HTTP: Express app on an ephemeral port, in-memory storage, Node's global fetch.
 * (These need `npm install` because they import Express; the logic underneath is covered in the other files.)
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/http/app.ts';
import { VALID_LEAD, makeWorld } from './helpers.ts';
import type { TestWorld } from './helpers.ts';

interface Harness {
  world: TestWorld;
  base: string;
  server: Server;
}

async function start(env: Record<string, string> = {}): Promise<Harness> {
  const world = makeWorld({ env });
  const app = createApp(world.container);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { world, base: `http://127.0.0.1:${port}/api/v1`, server };
}

const stop = (h: Harness): Promise<void> => new Promise((resolve) => h.server.close(() => resolve()));

async function call(h: Harness, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${h.base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

describe('REST API', () => {
  let h: Harness;
  before(async () => {
    h = await start({ RATE_LIMIT_LEADS_MAX: '100' });
  });
  after(() => stop(h));

  it('GET /loan-schemes → the two seeded plans', async () => {
    const r = await call(h, 'GET', '/loan-schemes');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.map((p: { id: string }) => p.id), ['PLAN_BULLET_01', 'PLAN_EMI_01']);
  });

  it('POST /quotes: cases 1-3, and it writes nothing', async () => {
    const q1 = await call(h, 'POST', '/quotes', { netWeightGrams: 45, grossWeightGrams: 50, karat: 22 });
    assert.equal(q1.status, 200);
    assert.equal(q1.json.pureGoldMg, 41_250);
    assert.equal(q1.json.goldValuePaise, 28_875_000);
    const loans = Object.fromEntries(q1.json.plans.map((p: any) => [p.planId, p.eligibleLoanRupees]));
    assert.equal(loans.PLAN_EMI_01, 216_562);
    assert.equal(loans.PLAN_BULLET_01, 202_125);

    const q3 = await call(h, 'POST', '/quotes', { netWeightGrams: 10, grossWeightGrams: 10, karat: 18 });
    assert.equal(q3.json.plans.find((p: any) => p.planId === 'PLAN_EMI_01').eligibleLoanRupees, 39_375);

    const list = await call(h, 'GET', '/leads');
    assert.equal(list.json.total, 0);
  });

  it('case 4: net 52 > gross 50 → 400 with the error on netWeightGrams', async () => {
    const r = await call(h, 'POST', '/leads', { ...VALID_LEAD, netWeightGrams: 52, grossWeightGrams: 50 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.ok(r.json.error.fields.some((f: any) => f.field === 'netWeightGrams'));
  });

  it('case 5: bad mobile → 400 on mobileNumber', async () => {
    for (const mobileNumber of ['5876543210', '98765']) {
      const r = await call(h, 'POST', '/leads', { ...VALID_LEAD, mobileNumber });
      assert.equal(r.status, 400);
      assert.ok(r.json.error.fields.some((f: any) => f.field === 'mobileNumber'));
    }
  });

  it('unknown plan → 404', async () => {
    const r = await call(h, 'POST', '/leads', { ...VALID_LEAD, planId: 'PLAN_NOPE' });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'PLAN_NOT_FOUND');
  });

  it('case 6: create → 201, repeat → 409 with the existing applicationId; GET /leads masks the mobile', async () => {
    const created = await call(h, 'POST', '/leads', VALID_LEAD);
    assert.equal(created.status, 201);
    assert.equal(created.json.status, 'SUBMITTED');
    assert.match(created.json.applicationId, /^GL-\d+$/);

    const dup = await call(h, 'POST', '/leads', VALID_LEAD);
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error.details.applicationId, created.json.applicationId);

    const list = await call(h, 'GET', '/leads');
    assert.equal(list.json.data[0].mobileNumber, '9876XXXX10');
    assert.doesNotMatch(list.text, /9876543210/);
  });

  it('GET /leads: newest first, filter by plan, pagination', async () => {
    for (const [i, m] of ['9000000001', '9000000002', '9000000003'].entries()) {
      h.world.clock.advanceMs(1000);
      await call(h, 'POST', '/leads', { ...VALID_LEAD, mobileNumber: m, planId: i === 0 ? 'PLAN_BULLET_01' : 'PLAN_EMI_01' });
    }
    const all = await call(h, 'GET', '/leads?pageSize=2&page=1');
    assert.equal(all.json.data.length, 2);
    assert.equal(all.json.data[0].mobileNumber, '9000XXXX03');
    const bullet = await call(h, 'GET', '/leads?planId=PLAN_BULLET_01');
    assert.equal(bullet.json.data.every((l: any) => l.planId === 'PLAN_BULLET_01'), true);
  });

  it('case 7: the same Idempotency-Key replays the original 201', async () => {
    const headers = { 'Idempotency-Key': 'http-idem-0001' };
    const body = { ...VALID_LEAD, mobileNumber: '9111111111' };
    const a = await call(h, 'POST', '/leads', body, headers);
    const b = await call(h, 'POST', '/leads', body, headers);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers.get('idempotent-replayed'), 'true');
    assert.equal(b.json.applicationId, a.json.applicationId);
  });

  it('case 8: two parallel requests → exactly one 201 and one 409', async () => {
    const body = { ...VALID_LEAD, mobileNumber: '9222222222' };
    const results = await Promise.all([call(h, 'POST', '/leads', body), call(h, 'POST', '/leads', body)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });

  it('status workflow with audit log', async () => {
    const created = await call(h, 'POST', '/leads', { ...VALID_LEAD, mobileNumber: '9333333333' });
    const id = created.json.applicationId;
    assert.equal((await call(h, 'PATCH', `/leads/${id}/status`, { status: 'APPROVED' })).status, 409);
    assert.equal((await call(h, 'PATCH', `/leads/${id}/status`, { status: 'UNDER_REVIEW' })).json.status, 'UNDER_REVIEW');
    const audit = await call(h, 'GET', `/leads/${id}/audit`);
    assert.deepEqual(audit.json.data.map((a: any) => a.toStatus), ['SUBMITTED', 'UNDER_REVIEW']);
  });

  it('GET /leads/:id → the full application after approval: plan terms, EMI and the whole history', async () => {
    const created = await call(h, 'POST', '/leads', { ...VALID_LEAD, mobileNumber: '9444444444' });
    assert.equal(created.status, 201);
    // the 201 already carries the repayment figures the success screen shows
    assert.equal(created.json.lead.indicative.monthlyEmiPaise, 1_908_964);
    const id = created.json.applicationId;
    await call(h, 'PATCH', `/leads/${id}/status`, { status: 'UNDER_REVIEW' });
    await call(h, 'PATCH', `/leads/${id}/status`, { status: 'APPROVED' });

    const r = await call(h, 'GET', `/leads/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'APPROVED');
    assert.equal(r.json.mobileNumber, '9444XXXX44');
    assert.deepEqual(
      [r.json.repaymentType, r.json.annualInterestPercent, r.json.tenureMonths, r.json.appliedLtvPercent],
      ['EMI', 10.5, 12, 75],
    );
    assert.equal(r.json.eligibleLoanRupees, 216_562);
    assert.equal(r.json.indicative.monthlyEmiPaise, 1_908_964);
    assert.deepEqual(r.json.history.map((a: any) => a.toStatus), ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);
    assert.equal((await call(h, 'GET', '/leads/GL-9999')).json.error.code, 'LEAD_NOT_FOUND');
  });

  it('POST /leads/lookup: the applicant sees their application only with the matching mobile', async () => {
    const created = await call(h, 'POST', '/leads', { ...VALID_LEAD, mobileNumber: '9555555555', planId: 'PLAN_BULLET_01' });
    const id = created.json.applicationId;

    const ok = await call(h, 'POST', '/leads/lookup', { applicationId: ` ${id.toLowerCase()} `, mobileNumber: '9555555555' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.applicationId, id);
    assert.equal(ok.json.mobileNumber, '9555XXXX55', 'still masked, even for the owner');
    assert.equal(ok.json.indicative.monthlyEmiPaise, null, 'bullet plan: no EMI');
    assert.equal(ok.json.indicative.totalInterestPaise, 2_425_500, '₹2,02,125 at 12% for 12 months = ₹24,255');

    const wrongMobile = await call(h, 'POST', '/leads/lookup', { applicationId: id, mobileNumber: '9555555556' });
    const wrongId = await call(h, 'POST', '/leads/lookup', { applicationId: 'GL-99999', mobileNumber: '9555555555' });
    assert.equal(wrongMobile.status, 404);
    assert.deepEqual(wrongMobile.json, wrongId.json, 'a wrong id and a wrong mobile get the same answer');

    const bad = await call(h, 'POST', '/leads/lookup', { applicationId: '1001', mobileNumber: '98765' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json.error.fields.map((f: any) => f.field).sort(), ['applicationId', 'mobileNumber']);
  });

  it('GET /leads/summary → count and loan total per status (route is not mistaken for an application id)', async () => {
    const r = await call(h, 'GET', '/leads/summary');
    assert.equal(r.status, 200);
    const counted = Object.values(r.json.byStatus as Record<string, { count: number }>).reduce((n, s) => n + s.count, 0);
    assert.equal(counted, r.json.total);
    assert.ok(r.json.total >= 1);
    assert.ok(r.json.byStatus.APPROVED.count >= 1, 'an application was approved earlier in this suite');
  });

  it('errors are always JSON with the same shape – malformed JSON, unknown routes', async () => {
    const bad = await call(h, 'POST', '/leads', '{not json');
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'INVALID_JSON');
    assert.deepEqual(Object.keys(bad.json.error).sort().slice(0, 3), ['code', 'fields', 'message']);

    const missing = await call(h, 'GET', '/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'ROUTE_NOT_FOUND');
  });

  it('a crash becomes a JSON 500 without a stack trace or internals', async () => {
    const original = h.world.container.quoteService.quote.bind(h.world.container.quoteService);
    h.world.container.quoteService.quote = async () => {
      throw new Error('db password is hunter2 at /srv/app/secret.ts:12');
    };
    try {
      const r = await call(h, 'POST', '/quotes', { netWeightGrams: 10, grossWeightGrams: 10, karat: 22 });
      assert.equal(r.status, 500);
      assert.equal(r.json.error.code, 'INTERNAL_ERROR');
      assert.doesNotMatch(r.text, /hunter2|secret\.ts|\bat \S+:\d+/);
    } finally {
      h.world.container.quoteService.quote = original;
    }
  });

  it('GET /health reports storage and assistant', async () => {
    const r = await call(h, 'GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.storage, 'memory');
  });
});

describe('Chat API', () => {
  let h: Harness;
  before(async () => {
    h = await start();
  });
  after(() => stop(h));

  it('quote → card → Confirm files the lead; the same lead shows up in GET /leads', async () => {
    const a = await call(h, 'POST', '/chat', { message: 'I have 45 g net, 50 g gross, 22 karat gold' });
    assert.equal(a.status, 200);
    assert.match(a.json.reply, /₹2,16,562/);
    const sessionId = a.json.sessionId;

    const b = await call(h, 'POST', '/chat', { sessionId, message: 'EMI plan, Asha Patel, 9123456789' });
    assert.ok(b.json.pendingConfirmation);

    const c = await call(h, 'POST', '/chat/confirm', { sessionId, actionId: b.json.pendingConfirmation.actionId, decision: 'confirm' });
    assert.equal(c.status, 200);
    assert.match(c.json.submitted.applicationId, /^GL-\d+$/);

    const list = await call(h, 'GET', '/leads');
    assert.equal(list.json.data[0].mobileNumber, '9123XXXX89');
  });

  it('rejects an empty message and an expired session with the standard error shape', async () => {
    assert.equal((await call(h, 'POST', '/chat', { message: '   ' })).status, 400);
    const r = await call(h, 'POST', '/chat/confirm', { sessionId: 'unknown-session-id', actionId: 'unknown-action-id', decision: 'confirm' });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'SESSION_NOT_FOUND');
  });
});

describe('security headers', () => {
  it('refuses framing by default, and allows only Hugging Face inside a Space', async () => {
    const local = await start();
    const space = await start({ SPACE_ID: 'someone/GoldLoan' });
    try {
      const a = await call(local, 'GET', '/health');
      assert.equal(a.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.match(a.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'(;|$)/);
      const b = await call(space, 'GET', '/health');
      assert.equal(b.headers.get('x-frame-options'), null);
      assert.match(b.headers.get('content-security-policy') ?? '', /frame-ancestors 'self' https:\/\/huggingface\.co https:\/\/\*\.hf\.space/);
    } finally {
      await stop(local);
      await stop(space);
    }
  });
});

describe('rate limiting (B4)', () => {
  let h: Harness;
  before(async () => {
    h = await start({ RATE_LIMIT_LEADS_MAX: '3' });
  });
  after(() => stop(h));

  it('POST /leads is limited per client – the 4th request in the window gets 429 + Retry-After', async () => {
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof call>> | undefined;
    for (let i = 0; i < 4; i++) {
      last = await call(h, 'POST', '/leads', { ...VALID_LEAD, mobileNumber: `90000000${10 + i}` });
      statuses.push(last.status);
    }
    assert.deepEqual(statuses, [201, 201, 201, 429]);
    assert.ok(last!.headers.get('retry-after'));
    assert.equal(last!.json.error.code, 'RATE_LIMITED');
  });
});
