import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateLeadSchema, QuoteRequestSchema, zodToFieldErrors } from '@gold/shared/schemas';
import { IdempotencyKeyReusedError, InvalidStatusTransitionError, PlanNotFoundError } from '../src/lib/errors.ts';
import { VALID_LEAD, makeWorld } from './helpers.ts';

describe('PDF test cases 1-3 through the QuoteService', () => {
  it('case 1: 45 g · 22K · EMI → loan ₹2,16,562 (value ₹2,88,750, pure 41.25 g)', async () => {
    const { container } = makeWorld();
    const q = await container.quoteService.quote({ netWeightGrams: 45, grossWeightGrams: 50, karat: 22 });
    const emi = q.plans.find((p) => p.planId === 'PLAN_EMI_01')!;
    assert.equal(q.pureGoldMg, 41_250);
    assert.equal(q.goldValuePaise, 28_875_000);
    assert.equal(emi.eligibleLoanRupees, 216_562);
  });

  it('case 2: 45 g · 22K · Bullet → loan ₹2,02,125 (70% LTV)', async () => {
    const { container } = makeWorld();
    const q = await container.quoteService.quote({ netWeightGrams: 45, grossWeightGrams: 50, karat: 22 });
    assert.equal(q.plans.find((p) => p.planId === 'PLAN_BULLET_01')!.eligibleLoanRupees, 202_125);
  });

  it('case 3: 10 g · 18K · EMI → pure 7.5 g · value ₹52,500 · loan ₹39,375', async () => {
    const { container } = makeWorld();
    const q = await container.quoteService.quote({ netWeightGrams: 10, grossWeightGrams: 10, karat: 18 });
    assert.equal(q.pureGoldMg, 7_500);
    assert.equal(q.goldValuePaise, 5_250_000);
    assert.equal(q.plans.find((p) => p.planId === 'PLAN_EMI_01')!.eligibleLoanRupees, 39_375);
  });

  it('never lends more than 75% of the value, whatever the plan says', async () => {
    const { container } = makeWorld();
    const q = await container.quoteService.quote({ netWeightGrams: 123.456, grossWeightGrams: 130, karat: 24 });
    for (const p of q.plans) assert.ok(p.eligibleLoanRupees * 100 <= q.goldValuePaise * 0.75);
  });
});

describe('validation (cases 4-5) – same Zod schemas used by REST and by the agent', () => {
  it('case 4: net 52 > gross 50 → error on netWeightGrams', () => {
    const r = CreateLeadSchema.safeParse({ ...VALID_LEAD, netWeightGrams: 52, grossWeightGrams: 50 });
    assert.equal(r.success, false);
    if (!r.success) assert.equal(zodToFieldErrors(r.error)[0]!.field, 'netWeightGrams');
  });

  it('case 5: mobile 5876543210 and 98765 → error on mobileNumber', () => {
    for (const bad of ['5876543210', '98765']) {
      const r = CreateLeadSchema.safeParse({ ...VALID_LEAD, mobileNumber: bad });
      assert.equal(r.success, false, bad);
      if (!r.success) assert.ok(zodToFieldErrors(r.error).some((f) => f.field === 'mobileNumber'));
    }
  });

  it('rejects karat 20, gross over 1000 g, net 0 and a numeric name', () => {
    assert.equal(QuoteRequestSchema.safeParse({ netWeightGrams: 10, grossWeightGrams: 10, karat: 20 }).success, false);
    assert.equal(QuoteRequestSchema.safeParse({ netWeightGrams: 10, grossWeightGrams: 1001, karat: 22 }).success, false);
    assert.equal(QuoteRequestSchema.safeParse({ netWeightGrams: 0, grossWeightGrams: 10, karat: 22 }).success, false);
    assert.equal(CreateLeadSchema.safeParse({ ...VALID_LEAD, name: 'R2D2' }).success, false);
  });

  it('strips client-supplied money fields so they can never be trusted', () => {
    const r = CreateLeadSchema.safeParse({ ...VALID_LEAD, eligibleLoanRupees: 9_999_999, status: 'APPROVED' });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal('eligibleLoanRupees' in r.data, false);
      assert.equal('status' in r.data, false);
    }
  });
});

describe('LeadService.submit', () => {
  it('creates a SUBMITTED lead and recomputes the loan on the server', async () => {
    const { container } = makeWorld();
    const res = await container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    assert.equal(res.statusCode, 201);
    if (res.statusCode !== 201) return;
    assert.match(res.body.applicationId, /^GL-\d+$/);
    assert.equal(res.body.status, 'SUBMITTED');
    assert.equal(res.body.lead.eligibleLoanRupees, 216_562);
    assert.equal(res.body.lead.mobileNumber, '9876XXXX10', 'the response never exposes the full mobile');
  });

  it('unknown plan → PlanNotFoundError (404)', async () => {
    const { container } = makeWorld();
    await assert.rejects(
      container.leadService.submit({ ...VALID_LEAD, planId: 'PLAN_NOPE' }, { channel: 'FORM' }),
      (e: unknown) => e instanceof PlanNotFoundError && e.statusCode === 404,
    );
  });

  it('case 6: same mobile within 7 days → 409 carrying the existing applicationId', async () => {
    const { container, clock } = makeWorld();
    const first = await container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    clock.advanceDays(2);
    const second = await container.leadService.submit({ ...VALID_LEAD, name: 'Someone Else' }, { channel: 'FORM' });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 409);
    if (first.statusCode === 201 && second.statusCode === 409) {
      assert.equal(second.body.error.code, 'DUPLICATE_APPLICATION');
      assert.equal(second.body.error.details?.applicationId, first.body.applicationId);
    }
  });

  it('the 7-day window: day 6 is blocked, day 8 is allowed', async () => {
    const day6 = makeWorld();
    await day6.container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    day6.clock.advanceDays(6);
    assert.equal((await day6.container.leadService.submit(VALID_LEAD, { channel: 'FORM' })).statusCode, 409);

    const day8 = makeWorld();
    await day8.container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    day8.clock.advanceDays(8);
    assert.equal((await day8.container.leadService.submit(VALID_LEAD, { channel: 'FORM' })).statusCode, 201);
  });

  it('a different mobile is never treated as a duplicate', async () => {
    const { container } = makeWorld();
    await container.leadService.submit(VALID_LEAD, { channel: 'FORM' });
    const other = await container.leadService.submit({ ...VALID_LEAD, mobileNumber: '9123456789' }, { channel: 'FORM' });
    assert.equal(other.statusCode, 201);
  });

  it('case 7 (bonus): the same Idempotency-Key replays the original 201 – even after the 7-day window', async () => {
    const { container, clock } = makeWorld();
    const key = 'idem-key-0001';
    const first = await container.leadService.submit(VALID_LEAD, { channel: 'FORM', idempotencyKey: key });
    clock.advanceDays(30);
    const replay = await container.leadService.submit(VALID_LEAD, { channel: 'FORM', idempotencyKey: key });
    assert.equal(first.statusCode, 201);
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.replayed, true);
    if (first.statusCode === 201 && replay.statusCode === 201) {
      assert.equal(replay.body.applicationId, first.body.applicationId);
    }
    const page = await container.leadService.list({ page: 1, pageSize: 20 });
    assert.equal(page.total, 1, 'exactly one lead exists');
  });

  it('an Idempotency-Key reused with a different body is rejected (422)', async () => {
    const { container } = makeWorld();
    await container.leadService.submit(VALID_LEAD, { channel: 'FORM', idempotencyKey: 'idem-key-0002' });
    await assert.rejects(
      container.leadService.submit({ ...VALID_LEAD, netWeightGrams: 40 }, { channel: 'FORM', idempotencyKey: 'idem-key-0002' }),
      (e: unknown) => e instanceof IdempotencyKeyReusedError && e.statusCode === 422,
    );
  });

  it('case 8 (bonus): 2 parallel requests for one mobile → exactly one 201 and one 409', async () => {
    const { container } = makeWorld();
    const results = await Promise.all([
      container.leadService.submit(VALID_LEAD, { channel: 'FORM' }),
      container.leadService.submit(VALID_LEAD, { channel: 'FORM' }),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  });

  it('20 parallel requests for one mobile → still exactly one lead', async () => {
    const { container } = makeWorld();
    const results = await Promise.all(Array.from({ length: 20 }, () => container.leadService.submit(VALID_LEAD, { channel: 'FORM' })));
    assert.equal(results.filter((r) => r.statusCode === 201).length, 1);
    assert.equal(results.filter((r) => r.statusCode === 409).length, 19);
  });
});

describe('LeadService – listing and workflow', () => {
  it('lists newest first with masked mobiles, filters by plan and paginates', async () => {
    const { container, clock } = makeWorld();
    const mobiles = ['9000000001', '9000000002', '9000000003'];
    for (const [i, mobile] of mobiles.entries()) {
      await container.leadService.submit(
        { ...VALID_LEAD, mobileNumber: mobile, planId: i === 1 ? 'PLAN_BULLET_01' : 'PLAN_EMI_01' },
        { channel: 'FORM' },
      );
      clock.advanceMs(1000);
    }
    const all = await container.leadService.list({ page: 1, pageSize: 20 });
    assert.equal(all.total, 3);
    assert.equal(all.data[0]!.mobileNumber, '9000XXXX03', 'newest first, masked');

    const bullet = await container.leadService.list({ page: 1, pageSize: 20, planId: 'PLAN_BULLET_01' });
    assert.equal(bullet.total, 1);

    const page2 = await container.leadService.list({ page: 2, pageSize: 2 });
    assert.equal(page2.data.length, 1);
  });

  it('status workflow SUBMITTED → UNDER_REVIEW → APPROVED writes an audit log; illegal jumps are refused', async () => {
    const { container } = makeWorld();
    const created = await container.leadService.submit(VALID_LEAD, { channel: 'AGENT' });
    assert.equal(created.statusCode, 201);
    if (created.statusCode !== 201) return;
    const id = created.body.applicationId;

    await assert.rejects(container.leadService.transition(id, 'APPROVED'), (e: unknown) => e instanceof InvalidStatusTransitionError);
    assert.equal((await container.leadService.transition(id, 'UNDER_REVIEW')).status, 'UNDER_REVIEW');
    assert.equal((await container.leadService.transition(id, 'APPROVED')).status, 'APPROVED');
    await assert.rejects(container.leadService.transition(id, 'REJECTED'), (e: unknown) => e instanceof InvalidStatusTransitionError);

    const audit = await container.leadService.getAudit(id);
    assert.deepEqual(
      audit.map((a) => a.toStatus),
      ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'],
    );
    assert.equal(audit[0]!.channel, 'AGENT');
  });
});
