// specs/plugins-phase-3a-online-payment.md rule 4 (reading of 2026-11-01, audit R12 plugins L-1):
// the plugin-facing table of `ctx.paymentProvider` lists the same `getPayment` fields as the
// contract the core enforces in utils/paymentProviders.js (payment-link-lifecycle rule 64).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const fieldsOf = (shape) => shape.replace(/[{}\s?]/g, '').split(',').filter(Boolean).sort();

function specGetPaymentFields() {
  const row = read('specs/plugins-phase-3a-online-payment.md')
    .split('\n')
    .find((line) => line.trim().startsWith('| `getPayment(linkId)` |'));
  assert.ok(row, 'rule 4 table has a getPayment row');
  const shape = row.match(/\|\s*`(\{[^`]+\})`/);
  assert.ok(shape, 'the getPayment row states its answer shape');
  return fieldsOf(shape[1]);
}

function coreGetPaymentFields() {
  const line = read('server/src/utils/paymentProviders.js')
    .split('\n')
    .find((l) => /^\s*\*\s+getPayment\(/.test(l));
  assert.ok(line, 'paymentProviders.js documents getPayment');
  return fieldsOf(line.match(/→\s*(\{[^}]+\})/)[1]);
}

test('rule 4 — the spec table lists the getPayment fields the core reads, pending included', () => {
  const spec = specGetPaymentFields();
  assert.deepEqual(spec, coreGetPaymentFields());
  assert.ok(spec.includes('pending'), 'pending is part of the plugin-facing contract');
});

test('rule 4 — the spec says an answer without pending counts as in flight', () => {
  const row = read('specs/plugins-phase-3a-online-payment.md')
    .split('\n')
    .find((line) => line.trim().startsWith('| `getPayment(linkId)` |'));
  assert.match(row, /`pending` is a boolean/);
  assert.match(row, /without it counts as in flight/);
});
