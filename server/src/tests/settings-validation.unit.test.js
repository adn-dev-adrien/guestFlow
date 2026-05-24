const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateEmail,
  validateSiret,
  validateTvaIntracom,
  validateIban,
  validateBic,
  validatePrivateKey,
  validateCalendarId,
  validateQuoteValidityDays,
} = require('../utils/settingsValidation');

const SAMPLE_PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj',
  '-----END PRIVATE KEY-----',
].join('\n');

// --- email ---
test('validateEmail: empty is valid', () => {
  assert.equal(validateEmail(''), null);
  assert.equal(validateEmail(null), null);
});
test('validateEmail: valid', () => {
  assert.equal(validateEmail('a@b.com'), null);
  assert.equal(validateEmail('robot@projet.iam.gserviceaccount.com'), null);
});
test('validateEmail: invalid', () => {
  assert.match(validateEmail('no-at-sign'), /invalide/);
  assert.match(validateEmail('foo@'), /invalide/);
  assert.match(validateEmail('@bar.com'), /invalide/);
});

// --- SIRET ---
test('validateSiret: empty is valid', () => assert.equal(validateSiret(''), null));
test('validateSiret: 14 digits passes', () => assert.equal(validateSiret('12345678901234'), null));
test('validateSiret: tolerant of spaces', () => assert.equal(validateSiret('123 456 789 00012'), null));
test('validateSiret: rejects wrong length', () => {
  assert.match(validateSiret('123'), /14 chiffres/);
  assert.match(validateSiret('123456789012345'), /14 chiffres/);
});
test('validateSiret: rejects non-digits', () => {
  assert.match(validateSiret('1234567890123A'), /14 chiffres/);
});

// --- TVA ---
test('validateTvaIntracom: empty is valid', () => assert.equal(validateTvaIntracom(''), null));
test('validateTvaIntracom: FR + 11 digits passes', () => {
  assert.equal(validateTvaIntracom('FR12345678901'), null);
});
test('validateTvaIntracom: rejects no country prefix', () => {
  assert.match(validateTvaIntracom('12345678901'), /TVA/);
});

// --- IBAN ---
test('validateIban: empty is valid', () => assert.equal(validateIban(''), null));
test('validateIban: valid FR IBAN passes mod-97', () => {
  // Known-good IBAN: GB82 WEST 1234 5698 7654 32 (canonical IBAN example).
  assert.equal(validateIban('GB82WEST12345698765432'), null);
});
test('validateIban: tolerant of spaces', () => {
  assert.equal(validateIban('GB82 WEST 1234 5698 7654 32'), null);
});
test('validateIban: rejects bad checksum', () => {
  assert.match(validateIban('GB00WEST12345698765432'), /IBAN/);
});
test('validateIban: rejects too short', () => {
  assert.match(validateIban('FR12'), /IBAN/);
});

// --- BIC ---
test('validateBic: empty is valid', () => assert.equal(validateBic(''), null));
test('validateBic: 8-char passes', () => assert.equal(validateBic('BNPAFRPP'), null));
test('validateBic: 11-char passes', () => assert.equal(validateBic('BNPAFRPPXXX'), null));
test('validateBic: rejects 7-char', () => assert.match(validateBic('BNPAFRP'), /BIC/));
test('validateBic: rejects 9-char', () => assert.match(validateBic('BNPAFRPPX'), /BIC/));

// --- private key (PEM) ---
test('validatePrivateKey: empty is valid', () => assert.equal(validatePrivateKey(''), null));
test('validatePrivateKey: PKCS8 passes', () => assert.equal(validatePrivateKey(SAMPLE_PEM), null));
test('validatePrivateKey: RSA passes', () => {
  const rsa = '-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----';
  assert.equal(validatePrivateKey(rsa), null);
});
test('validatePrivateKey: EC passes', () => {
  const ec = '-----BEGIN EC PRIVATE KEY-----\nABC\n-----END EC PRIVATE KEY-----';
  assert.equal(validatePrivateKey(ec), null);
});
test('validatePrivateKey: rejects garbage', () => {
  assert.match(validatePrivateKey('garbage'), /BEGIN/);
});
test('validatePrivateKey: rejects missing END', () => {
  assert.match(validatePrivateKey('-----BEGIN PRIVATE KEY-----\nABC'), /END/);
});

// --- calendar ID ---
test('validateCalendarId: empty is valid', () => assert.equal(validateCalendarId(''), null));
test('validateCalendarId: typical IDs valid', () => {
  assert.equal(validateCalendarId('mon.agenda@gmail.com'), null);
  assert.equal(validateCalendarId('abc@group.calendar.google.com'), null);
});
test('validateCalendarId: rejects absurd length', () => {
  assert.match(validateCalendarId('a'.repeat(501)), /trop long/);
});

// --- quote validity ---
test('validateQuoteValidityDays: empty / null is valid (controller defaults)', () => {
  assert.equal(validateQuoteValidityDays(''), null);
  assert.equal(validateQuoteValidityDays(null), null);
});
test('validateQuoteValidityDays: 1 and 365 pass', () => {
  assert.equal(validateQuoteValidityDays(1), null);
  assert.equal(validateQuoteValidityDays(365), null);
  assert.equal(validateQuoteValidityDays('30'), null);
});
test('validateQuoteValidityDays: 0, 366, non-int rejected', () => {
  assert.match(validateQuoteValidityDays(0), /entre 1 et 365/);
  assert.match(validateQuoteValidityDays(366), /entre 1 et 365/);
  assert.match(validateQuoteValidityDays(15.5), /entre 1 et 365/);
});
