const test = require('node:test');
const assert = require('node:assert/strict');

const { isLineOffered, roundMoney } = require('../utils/devisHelpers');

// The guest must see what the rate already covers AND what it is worth: an offered or
// included-in-rate line prints its real amount STRUCK THROUGH on the devis / invoice, and is not
// counted in the total. The PDF detects such a line from the stored row (`totalPrice = 0` while the
// unit price survives) — this test pins that contract, which the strike-through rendering and the
// « OFFERT » badge both key off.

const line = (over = {}) => ({ unitPrice: 30, billedUnits: 1, quantity: 1, totalPrice: 0, ...over });

test('an included-in-rate line (billed 0, unit price kept) is detected as offered', () => {
  assert.equal(isLineOffered(line()), true);
  // …and the amount the PDF strikes through is the real one.
  const l = line();
  assert.equal(roundMoney(Number(l.unitPrice) * Number(l.billedUnits)), 30);
});

test('a per-person included line strikes through the full amount, not the unit price', () => {
  const l = line({ unitPrice: 8, billedUnits: 5 }); // linge de toilette, 5 personnes
  assert.equal(isLineOffered(l), true);
  assert.equal(roundMoney(Number(l.unitPrice) * Number(l.billedUnits)), 40);
});

test('a normally billed line is not offered and prints its own total', () => {
  assert.equal(isLineOffered(line({ totalPrice: 30 })), false);
});

test('a genuinely free line (no unit price) is not struck through — nothing to show', () => {
  assert.equal(isLineOffered(line({ unitPrice: 0 })), false);
  assert.equal(isLineOffered(line({ unitPrice: 0, totalPrice: 0 })), false);
});

test('a zero-quantity line is never offered', () => {
  assert.equal(isLineOffered(line({ billedUnits: 0, quantity: 0 })), false);
});
