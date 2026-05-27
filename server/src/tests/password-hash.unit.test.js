const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword } = require('../utils/passwordHash');

test('hash differs from plaintext and is tagged', () => {
  const h = hashPassword('Sup3rSecret!');
  assert.notEqual(h, 'Sup3rSecret!');
  assert.ok(h.startsWith('scrypt:'));
});

test('same password produces different hashes (random salt)', () => {
  assert.notEqual(hashPassword('same-password'), hashPassword('same-password'));
});

test('verifyPassword accepts the right password, rejects the wrong one', () => {
  const h = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', h), true);
  assert.equal(verifyPassword('wrong', h), false);
});

test('verifyPassword rejects malformed/empty stored values', () => {
  assert.equal(verifyPassword('x', ''), false);
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
  assert.equal(verifyPassword('x', 'scrypt:onlytwo'), false);
  assert.equal(verifyPassword('x', null), false);
});

test('hashPassword rejects empty input', () => {
  assert.throws(() => hashPassword(''));
});
