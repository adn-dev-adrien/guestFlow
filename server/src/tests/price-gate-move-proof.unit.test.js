// specs/pricing-components.md §3 rules 33, 35 and 73 — `scripts/price-gate/moveProof.js`: a removed source line must
// reappear verbatim (modulo indentation) among the added lines; only blank lines, imports and export lists may vanish.
const test = require('node:test');
const assert = require('node:assert/strict');
const { moveProof, parseDiff, isGlue, isSourcePath } = require('../../../scripts/price-gate/moveProof');

const diff = (...files) => files.map(({ path, old, hunks }) => [
  `diff --git a/${path} b/${path}`, `--- a/${old || path}`, `+++ b/${path}`,
  ...hunks.flatMap(({ at, removed = [], added = [] }) => [`@@ -${at},${removed.length} +${at},${added.length} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)]),
].join('\n')).join('\n');

const FN = ['function roundMoney(value) {', '  return Math.round(Number(value || 0) * 100) / 100;', '}'];

test('rule 73: a function moved to another file with another indentation is proved', () => {
  const text = diff(
    { path: 'server/src/utils/pricing.js', hunks: [{ at: 46, removed: FN }] },
    { path: 'server/src/utils/money.js', hunks: [{ at: 0, added: FN.map((l) => `    ${l}`) }] },
  );
  const result = moveProof(text);
  assert.deepEqual(result.unmatched, []);
  assert.equal(result.removed, 3);
  assert.equal(result.matched, 3);
});

test('rule 73: a moved line that changed by one character is named with its file and line', () => {
  const text = diff(
    { path: 'server/src/utils/pricing.js', hunks: [{ at: 46, removed: FN }] },
    { path: 'server/src/utils/money.js', hunks: [{ at: 0, added: ['function roundMoney(value) {', '  return Math.round(Number(value || 0) * 100) / 100.0;', '}'] }] },
  );
  const result = moveProof(text);
  assert.equal(result.unmatched.length, 1);
  assert.deepEqual(result.unmatched[0], { file: 'server/src/utils/pricing.js', line: 47, text: '  return Math.round(Number(value || 0) * 100) / 100;' });
});

test('rule 73: a rename inside a move leaves the renamed lines unmatched', () => {
  const text = diff(
    { path: 'server/src/utils/pricing.js', hunks: [{ at: 46, removed: FN }] },
    { path: 'server/src/utils/money.js', hunks: [{ at: 0, added: FN.map((l) => l.replace(/roundMoney/g, 'round2').replace('value', 'amount')) }] },
  );
  assert.equal(moveProof(text).unmatched.length, 2, 'the signature and the return; the closing brace is a twin');
});

test('rule 73: the multiset is respected — one added line proves one removed line', () => {
  const text = diff(
    { path: 'server/src/utils/pricing.js', hunks: [{ at: 10, removed: ['  total += 1;', '  total += 1;'] }] },
    { path: 'server/src/utils/money.js', hunks: [{ at: 0, added: ['total += 1;'] }] },
  );
  assert.deepEqual(moveProof(text).unmatched.map((u) => u.line), [11]);
});

test('rule 73: blank lines, requires, export lists and module.exports are glue; a formula is not', () => {
  for (const glue of ['', "const { roundMoney } = require('./money');", '} = require("./x");', 'module.exports = { a, b };', 'exports.a = a;', 'roundMoney,', 'compute: compute,', "'use strict';"]) {
    assert.ok(isGlue(glue.trim()), glue);
  }
  for (const logic of ['return a + b;', 'const total = a + b;', 'if (x) {', 'roundMoney(value) {', '// a comment', 'foo(),']) {
    assert.ok(!isGlue(logic), logic);
  }
  const text = diff({ path: 'server/src/utils/pricing.js', hunks: [{ at: 1, removed: ["const { a } = require('./a');", '', '  roundMoney,', 'return a + b;'] }] });
  const result = moveProof(text);
  assert.equal(result.glue, 3);
  assert.deepEqual(result.unmatched.map((u) => u.text), ['return a + b;']);
});

test('rule 73: only source files count — tests, fixtures and docs may change freely', () => {
  assert.ok(isSourcePath('server/src/utils/pricing.js'));
  assert.ok(isSourcePath('client/src/pages/ReservationPage.js'));
  assert.ok(!isSourcePath('server/src/tests/price-gate.unit.test.js'));
  assert.ok(!isSourcePath('server/src/plugins/some-plugin/tests/x.js'));
  assert.ok(!isSourcePath('client/src/__tests__/a.test.jsx'));
  assert.ok(!isSourcePath('specs/pricing-components.md'));
  assert.ok(!isSourcePath('scripts/pricing-replay.mjs'));
  const text = diff(
    { path: 'server/src/tests/helper.js', hunks: [{ at: 1, removed: ['anything at all'] }] },
    { path: 'specs/pricing-components.md', hunks: [{ at: 1, removed: ['prose'] }] },
  );
  assert.equal(moveProof(text).removed, 0);
});

test('rule 73: a deleted file is read from its old path, and a pure addition proves nothing is missing', () => {
  const deleted = ['diff --git a/server/src/utils/old.js b/server/src/utils/old.js', '--- a/server/src/utils/old.js', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-const a = 1;', '-const b = 2;'].join('\n');
  assert.deepEqual(moveProof(deleted).unmatched.map((u) => `${u.file}:${u.line}`), ['server/src/utils/old.js:1', 'server/src/utils/old.js:2']);
  const grown = diff({ path: 'server/src/utils/money.js', hunks: [{ at: 0, added: FN }] });
  assert.deepEqual(moveProof(grown), { removed: 0, matched: 0, glue: 0, unmatched: [], addedUnmatched: FN.map((text) => ({ file: 'server/src/utils/money.js', text })) });
  assert.deepEqual(parseDiff(''), { removed: [], added: [] });
});

test('rule 73: a removed `key: call(args),` with no added twin is reported, only `key: name,` is glue', () => {
  const text = diff({ path: 'server/src/utils/pricing.js', hunks: [{ at: 30, removed: ['    total: roundMoney(x),', '    total: x,', "    label: 'x',"] }] });
  const result = moveProof(text);
  assert.deepEqual(result.unmatched.map((u) => u.text.trim()), ['total: roundMoney(x),', "label: 'x',"]);
  assert.equal(result.glue, 1);
});

test('rule 73: a removed line is matched by an added line of its own file before one of another file', () => {
  const text = diff(
    { path: 'server/src/utils/pricing.js', hunks: [{ at: 10, removed: ['  total += 1;'], added: ['  total += 1;'] }] },
    { path: 'server/src/utils/money.js', hunks: [{ at: 0, added: ['total += 1;'] }] },
  );
  const result = moveProof(text);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.addedUnmatched, [{ file: 'server/src/utils/money.js', text: 'total += 1;' }], 'the twin in the other file is the one left over');
});

test('rule 73: an added non-glue line with no removed twin is listed, and listing it does not make the proof fail', () => {
  const text = diff(
    { path: 'server/src/utils/pricing.js', hunks: [{ at: 10, removed: FN }] },
    { path: 'server/src/utils/money.js', hunks: [{ at: 0, added: [...FN, 'if (x) return null;', "const { a } = require('./a');", ''] }] },
  );
  const result = moveProof(text);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.addedUnmatched, [{ file: 'server/src/utils/money.js', text: 'if (x) return null;' }]);
});
