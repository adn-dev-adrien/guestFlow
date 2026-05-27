const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Provide a key via env so the util never touches .env.local during tests.
process.env.GUESTFLOW_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const { encrypt, decrypt, isEncrypted } = require('../utils/encryption');

test('round-trips a value', () => {
  const secret = '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n';
  const enc = encrypt(secret);
  assert.ok(isEncrypted(enc));
  assert.notEqual(enc, secret);
  assert.equal(decrypt(enc), secret);
});

test('isEncrypted detects the tag', () => {
  assert.equal(isEncrypted('enc:v1:a:b:c'), true);
  assert.equal(isEncrypted('plain value'), false);
  assert.equal(isEncrypted(''), false);
  assert.equal(isEncrypted(null), false);
});

test('empty/nullish passes through unchanged', () => {
  assert.equal(encrypt(''), '');
  assert.equal(encrypt(null), null);
  assert.equal(encrypt(undefined), undefined);
  assert.equal(decrypt(''), '');
});

test('encrypt is idempotent on already-encrypted values', () => {
  const enc = encrypt('hello');
  assert.equal(encrypt(enc), enc);
});

test('legacy cleartext is returned as-is by decrypt (migration safety)', () => {
  assert.equal(decrypt('legacy-cleartext-key'), 'legacy-cleartext-key');
});

test('each encryption uses a fresh IV (different ciphertext for same input)', () => {
  assert.notEqual(encrypt('same'), encrypt('same'));
});

test('tampered ciphertext fails authentication', () => {
  const enc = encrypt('sensitive');
  const parts = enc.slice('enc:v1:'.length).split(':');
  const tampered = `enc:v1:${parts[0]}:${parts[1]}:${Buffer.from('garbage').toString('base64')}`;
  assert.throws(() => decrypt(tampered));
});
