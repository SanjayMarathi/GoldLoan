import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatGramsFromMg, formatPaise, formatPercent, formatRupees, groupIndian } from '../src/format.ts';
import { gramsToMg, hasAtMostThreeDecimals } from '../src/units.ts';

describe('Indian number formatting', () => {
  it('groups digits the Indian way', () => {
    assert.equal(groupIndian('0'), '0');
    assert.equal(groupIndian('999'), '999');
    assert.equal(groupIndian('1000'), '1,000');
    assert.equal(groupIndian('52500'), '52,500');
    assert.equal(groupIndian('288750'), '2,88,750');
    assert.equal(groupIndian('7000000'), '70,00,000');
    assert.equal(groupIndian('123456789'), '12,34,56,789');
  });

  it('formats the PDF example values exactly', () => {
    assert.equal(formatRupees(216562), '₹2,16,562');
    assert.equal(formatRupees(202125), '₹2,02,125');
    assert.equal(formatRupees(39375), '₹39,375');
    assert.equal(formatPaise(28_875_000), '₹2,88,750');
    assert.equal(formatPaise(5_250_000), '₹52,500');
  });

  it('shows paise only when they are not zero', () => {
    assert.equal(formatPaise(6_416_667), '₹64,166.67');
    assert.equal(formatPaise(100_005), '₹1,000.05');
    assert.equal(formatPaise(5), '₹0.05');
  });

  it('formats weights from milligrams', () => {
    assert.equal(formatGramsFromMg(41_250), '41.25 g');
    assert.equal(formatGramsFromMg(7_500), '7.5 g');
    assert.equal(formatGramsFromMg(45_000), '45 g');
    assert.equal(formatGramsFromMg(9_167), '9.167 g');
    assert.equal(formatGramsFromMg(500), '0.5 g');
  });

  it('formats percentages', () => {
    assert.equal(formatPercent(75), '75%');
    assert.equal(formatPercent(10.5), '10.5%');
    assert.equal(formatPercent(12), '12%');
  });
});

describe('weight units', () => {
  it('converts grams to integer milligrams without float drift', () => {
    assert.equal(gramsToMg(45), 45_000);
    assert.equal(gramsToMg(0.1), 100);
    assert.equal(gramsToMg(10.001), 10_001);
    assert.equal(gramsToMg(1.005), 1_005);
  });

  it('accepts at most 3 decimal places', () => {
    assert.equal(hasAtMostThreeDecimals(12.345), true);
    assert.equal(hasAtMostThreeDecimals(12.3456), false);
    assert.equal(hasAtMostThreeDecimals(Number.NaN), false);
  });
});
