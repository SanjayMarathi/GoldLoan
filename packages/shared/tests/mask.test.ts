import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskMobile, scrubDeep, scrubPII } from '../src/mask.ts';

describe('mobile masking', () => {
  it('masks the middle four digits (PDF format 9876XXXX10)', () => {
    assert.equal(maskMobile('9876543210'), '9876XXXX10');
  });

  it('never returns the original digits for odd input', () => {
    assert.equal(maskMobile('98765'), 'XXX65');
    assert.equal(maskMobile(''), 'XXXX');
  });

  it('scrubs 10-digit runs inside free text', () => {
    assert.equal(scrubPII('call me on 9876543210 please'), 'call me on 9876XXXX10 please');
    assert.equal(scrubPII('order 12345 is fine'), 'order 12345 is fine');
    assert.equal(scrubPII('id 98765432101234'), 'id 98765432101234');
  });

  it('scrubs deeply nested objects and sensitive keys', () => {
    const out = scrubDeep({
      req: { body: { name: 'Asha', mobileNumber: '9123456780' } },
      note: 'user wrote 9123456780',
      list: [{ phone: '9988776655' }],
    }) as any;
    assert.equal(out.req.body.mobileNumber, '9123XXXX80');
    assert.equal(out.req.body.name, 'Asha');
    assert.equal(out.note, 'user wrote 9123XXXX80');
    assert.equal(out.list[0].phone, '9988XXXX55');
  });
});
