// validateProviderConnection — Qonto provider-connection form. See specs/online-payments-qonto.md §3.2.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateProviderConnection } = require('../utils/paymentProviderValidation');

const VALID = {
  bankAccountId: 'acc_123',
  phone: '+33 6 12 34 56 78',
  websiteUrl: 'https://domainesolio.com',
  businessDescription: 'x'.repeat(80),
};

test('accepts a valid payload and normalises the phone', () => {
  const r = validateProviderConnection(VALID);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.value.phone, '+33612345678'); // spaces stripped
});

test('requires a bank account', () => {
  const r = validateProviderConnection({ ...VALID, bankAccountId: '' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /Compte bancaire/);
});

test('rejects a non-E.164 phone', () => {
  assert.equal(validateProviderConnection({ ...VALID, phone: '0612345678' }).ok, false); // no +
  assert.equal(validateProviderConnection({ ...VALID, phone: '+33' }).ok, false); // too short
});

test('rejects a non-http(s) website', () => {
  assert.equal(validateProviderConnection({ ...VALID, websiteUrl: 'domainesolio.com' }).ok, false);
  assert.equal(validateProviderConnection({ ...VALID, websiteUrl: 'ftp://x.y' }).ok, false);
});

test('requires a business description of at least 80 characters', () => {
  assert.equal(validateProviderConnection({ ...VALID, businessDescription: 'trop court' }).ok, false);
  assert.equal(validateProviderConnection({ ...VALID, businessDescription: 'a'.repeat(79) }).ok, false);
  assert.equal(validateProviderConnection({ ...VALID, businessDescription: 'a'.repeat(80) }).ok, true);
});
