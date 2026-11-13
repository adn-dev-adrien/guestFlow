// specs/pricing-components.md §3 rules 66, 80 — PR C leaves no copy of a formula waiting for a later PR: every allow-list of the static guards is empty. (An entry would be allowed only if its
// reason says it was kept by the owner's decision, « kept (Q-C5) »; there is none.) The guards themselves are `no-duplicate-formulas`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { GUARDS } = require('./helpers/formulaGuards');

const LISTS = path.join(__dirname, 'fixtures', 'no-duplicate-formulas');
const read = (name) => JSON.parse(fs.readFileSync(path.join(LISTS, name), 'utf8'));

test('rule 66 — every guard has an allow-list, and every allow-list is empty at the end of PR C', () => {
  const files = fs.readdirSync(LISTS).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, GUARDS.map((guard) => `${guard.name}.json`).sort(), 'one list per guard, no stray list');
  const left = [];
  for (const name of files) {
    for (const entry of read(name)) {
      if (!/^kept \(Q-C5\)/.test(entry.reason)) left.push(`${name}: ${entry.file} (${entry.removedBy})`);
    }
  }
  assert.deepEqual(left, [], 'a copy still waits for a PR that no longer exists: move it behind its home');
});

test('rule 66 — no entry is kept at all: the owner accepted none', () => {
  const kept = [];
  for (const name of fs.readdirSync(LISTS).filter((f) => f.endsWith('.json'))) kept.push(...read(name).map((entry) => `${name}: ${entry.file}`));
  assert.deepEqual(kept, []);
});
