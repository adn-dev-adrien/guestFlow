// specs/pricing-components.md §3 rules 15 and 51 — TOTALS aggregates and holds no formula: the sums of the provided parts, the
// discount unit's amount, the VAT unit's per-rate rows passed through as they came, and a static check that `totals.js` has
// no arithmetic of its own (no `*`, `/`, `roundMoney`, no percent) beyond calling the shared helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { aggregateTotals } = require('../utils/pricing/totals');
const { vatOf } = require('../utils/pricing/vat');
const { roundMoney, sumMoney } = require('../utils/pricing/money');
const { discountAmountOf } = require('../utils/pricing/discounts');

const PARTS = {
  accommodation: 380, extraGuestSurcharge: 20, optionsTotal: 72.1, resourcesTotal: 28, touristTaxTotal: 13.2, subtotal: 520.1,
};

test('rule 15 — finalPrice is the four priced parts, totalStayPrice adds the tourist tax, to the cent', () => {
  const totals = aggregateTotals(PARTS);
  assert.equal(totals.finalPrice, 500.1);
  assert.equal(totals.totalStayPrice, 513.3);
});

test('rule 15 — the sums equal the engine\'s left-to-right roundMoney on awkward cents', () => {
  for (let i = 0; i < 400; i += 1) {
    const [a, b, c, d, t] = [1, 2, 3, 4, 5].map((k) => roundMoney(((i * 7919 + k * 104729) % 100000) / 100 + 0.01 * k));
    const totals = aggregateTotals({
      accommodation: a, extraGuestSurcharge: b, optionsTotal: c, resourcesTotal: d, touristTaxTotal: t, subtotal: roundMoney(a + b + c + d),
    });
    assert.equal(totals.finalPrice, roundMoney(a + b + c + d));
    assert.equal(totals.totalStayPrice, roundMoney(roundMoney(a + b + c + d) + t));
  }
});

test('rule 15 — discountAmount is what DISCOUNTS says was taken off, never negative', () => {
  assert.equal(aggregateTotals({ ...PARTS, accommodation: 300 }).discountAmount, 100);
  assert.equal(aggregateTotals({ ...PARTS, accommodation: 420, subtotal: 520.1 }).discountAmount, 0);
  assert.equal(aggregateTotals(PARTS).discountAmount, discountAmountOf({ subtotal: 520.1, finalPrice: 500.1 }));
});

test('rule 51 — the VAT per rate is the VAT component\'s own rows, untouched; no VAT given, none shown', () => {
  const vat = vatOf([
    { amountCents: 40000, vatClass: 'accommodation', customerContext: 'hosted' },
    { amountCents: 7210, vatClass: 'options', customerContext: 'hosted' },
  ], { regime: { regime: 'subject', rate: 10 } });
  assert.equal(aggregateTotals({ ...PARTS, vat }).vatByRate, vat.byRate);
  assert.deepEqual(aggregateTotals(PARTS).vatByRate, []);
});

test('rule 15 — the breakdown lists the parts in the order the fiche prints them', () => {
  assert.deepEqual(aggregateTotals(PARTS).breakdown, [
    { key: 'accommodation', amount: 380 },
    { key: 'extraGuests', amount: 20 },
    { key: 'options', amount: 72.1 },
    { key: 'resources', amount: 28 },
    { key: 'touristTax', amount: 13.2 },
  ]);
});

test('rule 15 — sumMoney adds left to right and rounds once', () => {
  assert.equal(sumMoney([0.1, 0.2, 0.3]), 0.6);
  assert.equal(sumMoney([]), 0);
});

test('rule 15 — totals.js holds no formula: no multiplication, division, percent or rounding of its own', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'pricing', 'totals.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/^.*\brequire\(.*$/gm, '').replace(/module\.exports.*$/m, '');
  assert.doesNotMatch(source, /[*/%]/, 'no * / % operator');
  assert.doesNotMatch(source, /\broundMoney\b|\bMath\.(round|floor|ceil|max|min)\b/, 'no rounding or clamping of its own');
  const arithmetic = [...source.matchAll(/[A-Za-z_.\])]\s*[+-]\s*[A-Za-z_(\[]/g)].map((m) => m[0]);
  assert.deepEqual(arithmetic, [], 'no addition or subtraction outside sumMoney([...])');
});
