// specs/pricing-components.md §3 rules 16, 40, 58 and 59 — DISCOUNTS in cents: the targets `extras` and `all`, a fixed amount, the
// largest-remainder split (ties: accommodation, then lines by `soldAt`, then id), the lines a stay discount covers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateDiscount, coveredLines } = require('../utils/pricing/discounts');

const line = (ref, totalCents, extra = {}) => ({ ref, totalCents, source: 'fiche', soldAt: '2026-11-01', id: Number(String(ref).replace(/\D/g, '')) || 0, ...extra });

test('rule 16 — the target nights keeps the euro formula and the fixed amount comes off the accommodation, never below 0', () => {
  assert.equal(allocateDiscount({ discount: { percent: 10, target: 'nights' }, accommodation: 200 }).accommodation, 180);
  assert.equal(allocateDiscount({ discount: { target: 'nights' }, accommodation: 200 }).accommodation, 200, 'rule 58: no target typed reads as Nuits, a discount of 0 changes nothing');
  const amount = allocateDiscount({ discount: { amount: 30, target: 'nights' }, accommodation: 200 });
  assert.deepEqual([amount.accommodation, amount.discountCents], [170, 3000]);
  assert.equal(allocateDiscount({ discount: { amount: 500, target: 'nights' }, accommodation: 200 }).accommodation, 0);
});

test('rule 40 — extras: D = round(Σ target × p / 100), split in proportion, the cents left to the largest remainders', () => {
  const result = allocateDiscount({ discount: { percent: 10, target: 'extras' }, accommodation: 500, lines: [line('a1', 1000), line('b2', 1000), line('c3', 1000)] });
  assert.equal(result.discountCents, 300);
  assert.deepEqual(result.lines.map((l) => l.shareCents), [100, 100, 100]);
  assert.equal(result.accommodation, 500, 'the accommodation is not covered by « extras »');
  const odd = allocateDiscount({ discount: { percent: 10, target: 'extras' }, lines: [line('a1', 333), line('b2', 333), line('c3', 334)] });
  assert.equal(odd.discountCents, 100);
  assert.equal(odd.lines.reduce((sum, l) => sum + l.shareCents, 0), 100, 'Σ shares = D exactly');
  assert.deepEqual(odd.lines.map((l) => l.shareCents), [33, 33, 34]);
});

test('rule 40 — all: the accommodation is part of the target and wins a tie, then the lines by soldAt then id', () => {
  const result = allocateDiscount({ discount: { amount: 0.01, target: 'all' }, accommodation: 10, lines: [line('z9', 1000, { soldAt: '2026-11-03', id: 9 }), line('a1', 1000, { soldAt: '2026-11-02', id: 1 })] });
  assert.equal(result.discountCents, 1);
  assert.equal(result.accommodation, 9.99, 'three equal items, one cent: the accommodation takes it');
  assert.deepEqual(result.lines.map((l) => l.shareCents), [0, 0]);
  const tieOnLines = allocateDiscount({ discount: { amount: 0.01, target: 'extras' }, lines: [line('z9', 1000, { soldAt: '2026-11-03', id: 9 }), line('a1', 1000, { soldAt: '2026-11-02', id: 1 })] });
  assert.deepEqual(tieOnLines.lines.map((l) => [l.ref, l.shareCents]), [['a1', 1], ['z9', 0]], 'the earlier soldAt takes the cent');
});

test('rule 40 — a fixed amount is capped at the target and no line goes below 0', () => {
  const result = allocateDiscount({ discount: { amount: 100, target: 'all' }, accommodation: 20, lines: [line('a1', 500), line('b2', 300)] });
  assert.equal(result.discountCents, 2000 + 500 + 300);
  assert.equal(result.accommodation, 0);
  assert.deepEqual(result.lines.map((l) => l.shareCents), [500, 300]);
});

test('rules 16 and 59 — a stay discount covers only the unpaid, not offered lines sold with the stay', () => {
  const lines = [
    line('a1', 1000), line('b2', 1000, { offered: true }), line('c3', 1000, { settledCents: 1000 }), line('d4', 1000, { source: 'sas' }),
    line('e5', 1000, { source: 'shop' }), line('f6', 1000, { source: 'intake' }), line('g7', 1000, { source: 'devis' }),
  ];
  assert.deepEqual(coveredLines(lines).map((l) => l.ref), ['a1', 'f6', 'g7']);
  const result = allocateDiscount({ discount: { percent: 50, target: 'extras' }, lines });
  assert.equal(result.discountCents, 1500);
  assert.deepEqual(result.lines.map((l) => l.ref).sort(), ['a1', 'f6', 'g7']);
});

test('rule 40 — nothing to cover: no discount, the accommodation untouched', () => {
  const result = allocateDiscount({ discount: { percent: 10, target: 'extras' }, accommodation: 100, lines: [] });
  assert.deepEqual([result.discountCents, result.accommodation, result.lines], [0, 100, []]);
});
