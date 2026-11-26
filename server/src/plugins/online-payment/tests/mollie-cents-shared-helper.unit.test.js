// specs/pricing/pricing-components.md rule 38 (loop t10 A10-4) — mollieClient reads cents through the shared `toCentsStrict`, no private copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { centsOf } = require('../mollieClient');

test('centsOf reads a Mollie decimal string exactly as before and 0 for a missing amount', () => {
  assert.equal(centsOf({ value: '732.40' }), 73240);
  assert.equal(centsOf({ value: '0.00' }), 0);
  assert.equal(centsOf(null), 0);
  assert.equal(centsOf({}), 0);
});

test('mollieClient holds no private Math.round(x * 100) cents copy', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'mollieClient.js'), 'utf8');
  assert.ok(text.includes("sdk.coreModule('money')"));
  assert.equal(/Math\.round\([^;]*\*\s*100\)/.test(text), false);
});
