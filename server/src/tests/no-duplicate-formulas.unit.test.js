// specs/pricing-components.md §3 rules 65, 66 and 72 — static guards against a formula coming back: the VAT split lives in
// `utils/pricing/vat/` (rules 61-62), what a platform pays out lives in `utils/pricing/platformPayment.js` (rule 70) and
// every refund cap, trop-perçu and requalification figure lives in `utils/pricing/refunds/` (rule 72).
//
// Each guard scans the application sources (tests excluded, comments stripped) for its patterns outside its home and
// compares the hits with its allow-list, `fixtures/no-duplicate-formulas/<guard>.json`: `[{ file, text, count?, removedBy,
// reason }]`, one entry per distinct line still waiting for the PR that removes it (`count` when the same line repeats in
// the file). The comparison is a multiset: a second copy of a listed line fails. A hit that is not listed fails; a listed copy
// that is gone fails too (the entry is removed with it). THE LISTS MUST BE EMPTY AT THE END OF PR C.
// Every guard is declared in `helpers/formulaGuards.js` (patterns as shapes, home, scope, a probe per pattern); the scan and
// the judgement are `helpers/formulaScan.js`, proved below on synthetic sources (planted copies), not on the real tree.
// The lists are regenerated from the final tree with `node server/src/tests/helpers/regenerateFormulaAllowLists.js --write`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { GUARDS } = require('./helpers/formulaGuards');
const { hitsOfFiles, judge, keyOf } = require('./helpers/formulaScan');

const SRC = path.join(__dirname, '..');
const LISTS = path.join(__dirname, 'fixtures', 'no-duplicate-formulas');

function sources(dir = SRC, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests' && entry.name !== 'node_modules' && entry.name !== '__tests__') sources(full, out);
    } else if (entry.name.endsWith('.js')) out[path.relative(SRC, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

const tree = sources();

for (const guard of GUARDS) {
  const allowed = JSON.parse(fs.readFileSync(path.join(LISTS, `${guard.name}.json`), 'utf8'));
  test(`rule 66 — ${guard.name}: every entry of the allow-list names the copy, the PR that removes it and why it waits`, () => {
    assert.ok(Array.isArray(allowed));
    for (const entry of allowed) {
      assert.ok(['file', 'removedBy', 'text', 'reason'].every((key) => key in entry), keyOf(entry));
      assert.ok(Object.keys(entry).every((key) => ['file', 'text', 'count', 'removedBy', 'reason'].includes(key)), keyOf(entry));
      assert.match(entry.removedBy, /^PR (B|C)\b/, keyOf(entry));
      assert.ok(entry.reason.length > 10, keyOf(entry));
      if ('count' in entry) assert.ok(Number.isInteger(entry.count) && entry.count > 1, keyOf(entry));
    }
  });
  test(`rule 66 — ${guard.name}: no copy of the formula outside its home but the listed ones, none listed that is gone`, () => {
    const { unlisted, stale } = judge(hitsOfFiles(tree, guard), allowed);
    assert.deepEqual(unlisted, [], 'a copy of the formula: call its home, do not write it again');
    assert.deepEqual(stale, [], 'a listed copy is gone: regenerate the lists');
  });
}

test('rule 66 — each pattern of each guard catches its probe line, and no guard flags a clean line', () => {
  for (const { name, rules, patterns } of GUARDS) {
    for (const { re, probe } of rules) {
      for (const line of [].concat(probe)) assert.ok(re.test(line), `${name}: ${re} misses « ${line} »`);
    }
    for (const clean of ['const total = amount + other;', 'const cents = 100;', 'const n = items.length * 2;', 'return a - b;']) {
      assert.ok(!patterns.some((pattern) => pattern.test(clean)), `${name} flags a clean line: ${clean}`);
    }
  }
});

test('rule 66 — the date guard\'s allow-list is the rule 45 table of today\'s call sites: no entry waits for PR B any more (pass 4 moved them behind the stay clock)', () => {
  const dates = JSON.parse(fs.readFileSync(path.join(LISTS, 'dates.json'), 'utf8'));
  assert.ok(dates.length > 0);
  for (const entry of dates) assert.equal(entry.removedBy, 'PR C');
  assert.ok(dates.some((entry) => entry.file === 'utils/arrivalMoment.js' && entry.removedBy === 'PR C'));
});
