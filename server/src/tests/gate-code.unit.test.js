const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALPHABET,
  CODE_LENGTH,
  generateCode,
  normalizeCode,
  formatCode,
  makeSalt,
  hashCode,
  verifyCode,
} = require('../utils/gateCode');

// specs/guest-gate-access.md §3.1 rules 2 and 3.

// --- the alphabet ---
test('the alphabet holds 32 symbols and none of the four ambiguous letters', () => {
  assert.equal(ALPHABET.length, 32);
  for (const banned of ['I', 'L', 'O', 'U']) {
    assert.equal(ALPHABET.includes(banned), false, `${banned} must not be drawable`);
  }
  assert.equal(new Set(ALPHABET).size, 32, 'no symbol twice');
});

test('generateCode: 8 symbols, all from the alphabet', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateCode();
    assert.equal(code.length, CODE_LENGTH);
    for (const char of code) assert.ok(ALPHABET.includes(char), `${char} is not in the alphabet`);
  }
});

test('generateCode: draws differ (a constant would pass every other test here)', () => {
  const drawn = new Set();
  for (let i = 0; i < 500; i += 1) drawn.add(generateCode());
  assert.ok(drawn.size > 490, `expected ~500 distinct codes, got ${drawn.size}`);
});

test('generateCode: every symbol of the alphabet can come out', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) for (const char of generateCode()) seen.add(char);
  assert.equal(seen.size, 32, 'a symbol never drawn would mean a biased or truncated draw');
});

// --- what the guest actually types ---
test('normalizeCode: strips the display dash, spaces and case', () => {
  assert.equal(normalizeCode('4k7m-9qt2'), '4K7M9QT2');
  assert.equal(normalizeCode('4K7M 9QT2'), '4K7M9QT2');
  assert.equal(normalizeCode('  4K7M-9QT2  '), '4K7M9QT2');
  assert.equal(normalizeCode('4K7M 9QT2'), '4K7M9QT2', 'non-breaking space too');
});

test('normalizeCode: folds the substitutions a dictated code produces', () => {
  // "un" heard, letter typed
  assert.equal(normalizeCode('4K7MIQT2'), normalizeCode('4K7M1QT2'));
  assert.equal(normalizeCode('4K7MLQT2'), normalizeCode('4K7M1QT2'));
  // "zéro" heard, letter typed
  assert.equal(normalizeCode('4K7MOQT2'), normalizeCode('4K7M0QT2'));
});

test('normalizeCode: anything that cannot be a code is null, not a guess', () => {
  assert.equal(normalizeCode(''), null);
  assert.equal(normalizeCode('4K7M'), null, 'too short');
  assert.equal(normalizeCode('4K7M9QT2X'), null, 'too long');
  assert.equal(normalizeCode('4K7M-9QT'), null);
  assert.equal(normalizeCode(null), null);
  assert.equal(normalizeCode(undefined), null);
  assert.equal(normalizeCode(42), null);
  assert.equal(normalizeCode({ code: '4K7M9QT2' }), null);
  assert.equal(normalizeCode('UUUUUUUU'), null, 'U is not in the alphabet and is not folded');
});

test('formatCode: groups by four, and refuses to format a non-code', () => {
  assert.equal(formatCode('4K7M9QT2'), '4K7M-9QT2');
  assert.equal(formatCode('4k7m9qt2'), '4K7M-9QT2');
  assert.equal(formatCode('nope'), '');
});

// --- verification ---
test('hashCode / verifyCode: round-trip through the salted hash', () => {
  const code = generateCode();
  const codeSalt = makeSalt();
  const codeHash = hashCode(code, codeSalt);

  assert.match(codeHash, /^[0-9a-f]{64}$/);
  assert.ok(verifyCode(code, { codeHash, codeSalt }));
  assert.ok(verifyCode(formatCode(code), { codeHash, codeSalt }), 'the dashed form must pass');
  assert.ok(verifyCode(code.toLowerCase(), { codeHash, codeSalt }));
});

test('hashCode: the salt makes two identical codes hash differently', () => {
  const code = '4K7M9QT2';
  assert.notEqual(hashCode(code, makeSalt()), hashCode(code, makeSalt()));
});

test('verifyCode: a wrong code, a wrong salt or a missing record all fail', () => {
  const codeSalt = makeSalt();
  const codeHash = hashCode('4K7M9QT2', codeSalt);

  assert.equal(verifyCode('4K7M9QT3', { codeHash, codeSalt }), false);
  assert.equal(verifyCode('4K7M9QT2', { codeHash, codeSalt: makeSalt() }), false);
  assert.equal(verifyCode('4K7M9QT2', {}), false);
  assert.equal(verifyCode('4K7M9QT2', { codeHash, codeSalt: '' }), false);
  assert.equal(verifyCode('', { codeHash, codeSalt }), false);
  assert.equal(verifyCode(null, { codeHash, codeSalt }), false);
});

test('verifyCode: a malformed stored hash cannot throw its way past the check', () => {
  const codeSalt = makeSalt();
  assert.equal(verifyCode('4K7M9QT2', { codeHash: 'not-hex', codeSalt }), false);
  assert.equal(verifyCode('4K7M9QT2', { codeHash: 'ab', codeSalt }), false);
});
