import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateLeadSchema, QuoteRequestSchema, zodToFieldErrors } from '../src/schemas.ts';

const valid = {
  name: 'Ravi Kumar',
  mobileNumber: '9876543210',
  grossWeightGrams: 50,
  netWeightGrams: 45,
  karat: 22,
  planId: 'PLAN_EMI_01',
};

function fieldsOf(result: { success: boolean; error?: any }): Record<string, string> {
  if (result.success) return {};
  return Object.fromEntries(zodToFieldErrors(result.error).map((f) => [f.field, f.message]));
}

describe('CreateLeadSchema', () => {
  it('accepts a valid payload', () => {
    assert.equal(CreateLeadSchema.safeParse(valid).success, true);
  });

  it('PDF case 4: net 52 g > gross 50 g → error on netWeightGrams', () => {
    const f = fieldsOf(CreateLeadSchema.safeParse({ ...valid, netWeightGrams: 52 }));
    assert.ok(f.netWeightGrams, 'expected a netWeightGrams error');
  });

  it('PDF case 5: bad mobile numbers → error on mobileNumber', () => {
    for (const bad of ['5876543210', '98765', '98765432101', 'abcdefghij', '']) {
      const f = fieldsOf(CreateLeadSchema.safeParse({ ...valid, mobileNumber: bad }));
      assert.ok(f.mobileNumber, `expected mobile error for "${bad}"`);
    }
  });

  it('rejects a mobile number sent as a JSON number', () => {
    const f = fieldsOf(CreateLeadSchema.safeParse({ ...valid, mobileNumber: 9876543210 }));
    assert.ok(f.mobileNumber);
  });

  it('validates the name (2-60 chars, letters and spaces only)', () => {
    for (const bad of ['A', 'R2D2', 'Ravi_Kumar', 'x'.repeat(61), '   ']) {
      const f = fieldsOf(CreateLeadSchema.safeParse({ ...valid, name: bad }));
      assert.ok(f.name, `expected name error for "${bad}"`);
    }
    assert.equal(CreateLeadSchema.safeParse({ ...valid, name: '  Sunil Sharma ' }).success, true);
  });

  it('allows only karat 18 / 22 / 24', () => {
    for (const bad of [0, 14, 20, 23, 25, '22' as unknown as number]) {
      const f = fieldsOf(CreateLeadSchema.safeParse({ ...valid, karat: bad }));
      assert.ok(f.karat, `expected karat error for ${String(bad)}`);
    }
  });

  it('enforces 0 < net ≤ gross ≤ 1000 g', () => {
    assert.ok(fieldsOf(CreateLeadSchema.safeParse({ ...valid, netWeightGrams: 0 })).netWeightGrams);
    assert.ok(fieldsOf(CreateLeadSchema.safeParse({ ...valid, netWeightGrams: -1 })).netWeightGrams);
    assert.ok(fieldsOf(CreateLeadSchema.safeParse({ ...valid, grossWeightGrams: 1000.5 })).grossWeightGrams);
    assert.equal(CreateLeadSchema.safeParse({ ...valid, grossWeightGrams: 1000, netWeightGrams: 1000 }).success, true);
    assert.equal(CreateLeadSchema.safeParse({ ...valid, grossWeightGrams: 45, netWeightGrams: 45 }).success, true);
  });

  it('rejects more than 3 decimal places', () => {
    assert.ok(fieldsOf(CreateLeadSchema.safeParse({ ...valid, netWeightGrams: 45.1234 })).netWeightGrams);
  });

  it('strips client-sent money fields (the server never trusts them)', () => {
    const parsed = CreateLeadSchema.parse({ ...valid, eligibleLoan: 99999999, goldValue: 1 }) as Record<string, unknown>;
    assert.equal('eligibleLoan' in parsed, false);
    assert.equal('goldValue' in parsed, false);
  });
});

describe('QuoteRequestSchema', () => {
  it('needs net, gross and karat', () => {
    const f = fieldsOf(QuoteRequestSchema.safeParse({}));
    assert.ok(f.netWeightGrams && f.grossWeightGrams && f.karat);
  });

  it('accepts a valid request', () => {
    assert.equal(QuoteRequestSchema.safeParse({ netWeightGrams: 45, grossWeightGrams: 45, karat: 22 }).success, true);
  });
});
