// specs/pricing-components.md §3 rules 66, 80 — PR B leaves no copy of a formula waiting for it: every allow-list of the static guards holds no entry that PR B was to remove
// (what remains is PR C's, with its reason). The guards themselves are `no-duplicate-formulas`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LISTS = path.join(__dirname, 'fixtures', 'no-duplicate-formulas');

test('rule 66 — no allow-list holds an entry removedBy « PR B »', () => {
  const left = [];
  for (const name of fs.readdirSync(LISTS).filter((f) => f.endsWith('.json'))) {
    for (const entry of JSON.parse(fs.readFileSync(path.join(LISTS, name), 'utf8'))) {
      if (entry.removedBy === 'PR B') left.push(`${name}: ${entry.file}`);
    }
  }
  assert.deepEqual(left, []);
});

test('rule 66 — every entry that remains is PR C\'s and says why it waits', () => {
  for (const name of fs.readdirSync(LISTS).filter((f) => f.endsWith('.json'))) {
    for (const entry of JSON.parse(fs.readFileSync(path.join(LISTS, name), 'utf8'))) {
      assert.equal(entry.removedBy, 'PR C', `${name}: ${entry.file}`);
      assert.ok(entry.reason.length > 20);
    }
  }
});
