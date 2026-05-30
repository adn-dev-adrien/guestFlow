const test = require('node:test');
const assert = require('node:assert/strict');

const { generateTemporaryPassword, __test: { ALPHABET, UPPER, LOWER, DIGITS } } = require('../utils/passwordGenerator');

// The temp password is emailed to the new user, so we keep the alphabet readable
// (no I/O/l/0/1) and we guarantee one char per class so it visibly looks "complex enough".

test('default length is 12; explicit length is honoured', () => {
  assert.equal(generateTemporaryPassword().length, 12);
  assert.equal(generateTemporaryPassword(20).length, 20);
});

test('every character is drawn from the readable alphabet (no I/O/l/0/1)', () => {
  for (let i = 0; i < 500; i += 1) {
    const pwd = generateTemporaryPassword();
    for (const c of pwd) {
      assert.ok(ALPHABET.includes(c), `unexpected char ${JSON.stringify(c)} in ${pwd}`);
    }
    // The whitelist already excludes confusing characters, but double-check.
    assert.equal(/[IOl01]/.test(pwd), false, `confusing char in ${pwd}`);
  }
});

test('each password contains at least one upper, one lower and one digit', () => {
  for (let i = 0; i < 500; i += 1) {
    const pwd = generateTemporaryPassword();
    assert.ok([...UPPER].some((c) => pwd.includes(c)), `missing upper in ${pwd}`);
    assert.ok([...LOWER].some((c) => pwd.includes(c)), `missing lower in ${pwd}`);
    assert.ok([...DIGITS].some((c) => pwd.includes(c)), `missing digit in ${pwd}`);
  }
});

test('uniqueness: 1000 generations produce 1000 distinct strings (statistical sanity)', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) seen.add(generateTemporaryPassword());
  assert.equal(seen.size, 1000);
});

test('rejects out-of-range lengths', () => {
  assert.throws(() => generateTemporaryPassword(7), /INVALID_PASSWORD_LENGTH/);
  assert.throws(() => generateTemporaryPassword(65), /INVALID_PASSWORD_LENGTH/);
  assert.throws(() => generateTemporaryPassword(1.5), /INVALID_PASSWORD_LENGTH/);
});
