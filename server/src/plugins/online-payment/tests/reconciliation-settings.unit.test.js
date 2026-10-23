// specs/qonto-bank-reconciliation.md rule 23 — the « Rapprochement bancaire » settings of the plugin:
// what the generic settings endpoint accepts, and what only the reader may write.
const test = require('node:test');
const assert = require('node:assert/strict');
const { RECONCILIATION_DECLARED } = require('../settingsStore');

const validate = (key, value) => RECONCILIATION_DECLARED.find((d) => d.key === key).validate(value);

test('rule 23 — the start date is a day or empty', () => {
  assert.equal(validate('reconciliationStartDate', '2026-10-22'), null);
  assert.equal(validate('reconciliationStartDate', ''), null);
  assert.match(validate('reconciliationStartDate', '22/10/2026'), /invalide/);
});

test('rule 23 — the recognition patterns are one list of short texts per platform', () => {
  assert.equal(validate('reconciliationPlatformPatterns', JSON.stringify({ Booking: ['booking.com'] })), null);
  assert.equal(validate('reconciliationPlatformPatterns', ''), null, 'empty = the defaults');
  assert.match(validate('reconciliationPlatformPatterns', '[1,2]'), /invalides/);
  assert.match(validate('reconciliationPlatformPatterns', JSON.stringify({ Booking: 'booking.com' })), /invalides/);
  assert.match(validate('reconciliationPlatformPatterns', 'not json'), /invalides/);
});

test('rule 23 — the acquiring fee and the card fee are bounded numbers', () => {
  assert.equal(validate('reconciliationAcquiringFee', JSON.stringify({ percent: 1.4, fixedCents: 25 })), null);
  assert.match(validate('reconciliationAcquiringFee', JSON.stringify({ percent: 99, fixedCents: 25 })), /invalides/);
  assert.match(validate('reconciliationAcquiringFee', JSON.stringify({ percent: 1.4, fixedCents: 2.5 })), /invalides/);
  assert.equal(validate('reconciliationCardFeePercent', '2.8'), null);
  assert.match(validate('reconciliationCardFeePercent', '-1'), /invalides/);
});

test('rule 23 — the read outcome is written by the reader only', () => {
  assert.match(validate('reconciliationLastReadAt', '2026-10-22'), /Réglé/);
  assert.match(validate('reconciliationLastError', ''), /Réglé/);
});
