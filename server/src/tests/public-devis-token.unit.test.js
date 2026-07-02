// Per-devis capability token (specs/public-online-payment.md §7): generation + constant-time match.

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateToken, tokensMatch } = require('../utils/publicDevisToken');

test('generateToken: url-safe, long, and unique per call', () => {
  const a = generateToken();
  const b = generateToken();
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'base64url — safe in a URL/query');
  assert.ok(a.length >= 32, 'at least ~192 bits of entropy');
  assert.notEqual(a, b, 'two mints differ');
});

test('tokensMatch: true only for an exact non-empty match', () => {
  const t = generateToken();
  assert.equal(tokensMatch(t, t), true);
  assert.equal(tokensMatch(t, t + 'x'), false, 'different length');
  assert.equal(tokensMatch(t, generateToken()), false, 'different value');
});

test('tokensMatch: rejects empty / missing / non-string inputs (no throw)', () => {
  assert.equal(tokensMatch('', ''), false);
  assert.equal(tokensMatch('abc', ''), false);
  assert.equal(tokensMatch('', 'abc'), false);
  assert.equal(tokensMatch(null, 'abc'), false);
  assert.equal(tokensMatch('abc', undefined), false);
  assert.equal(tokensMatch('abc', 123), false);
});
