// specs/spec-rule-coverage.md rule 17 (audit R23-S1, 2026-11-05) — a rule number used twice in a spec's §3 is refused: a test
// citing it covers both, and a rule added under a taken number passed the gate with no test of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => import(path.join(ROOT, 'scripts', 'check-spec-coverage.mjs'));
const spec = (rules, after = '') => `# S\n\n## 3. Functional rules\n\n${rules}\n\n## 4. Architecture\n\n${after}\n`;

test('rule 17 — a number used twice in §3 is named, sub-sections included', async () => {
  const { duplicateRuleIds } = await load();
  assert.deepEqual(duplicateRuleIds(spec('1. A\n2. B\n\n### 3.2 C\n\n2. D\n3. E\n3. F')), ['2', '3']);
});

test('rule 17 — another suffix is another rule, and a list outside §3 is no rule', async () => {
  const { duplicateRuleIds } = await load();
  assert.deepEqual(duplicateRuleIds(spec('1. A\n1bis. B\n1b. C', '1. Plan\n1. Plan again')), []);
  assert.deepEqual(duplicateRuleIds('# No section\n\n1. A\n1. B\n'), []);
});

test('rule 17 — a superseded spec and the templates are not read', async () => {
  const { specsWithDuplicates } = await load();
  const twice = spec('1. A\n1. B');
  assert.deepEqual(specsWithDuplicates([
    ['live.md', twice],
    ['old.md', `| **Status** | Superseded |\n${twice}`],
    ['TEMPLATE.md', twice],
    ['notes.txt', twice],
  ]), [{ spec: 'live', rules: ['1'] }]);
});

test('rule 17 — no spec of this repository uses a number twice', async () => {
  const { specsWithDuplicates } = await load();
  const dir = path.join(ROOT, 'specs');
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
  assert.deepEqual(specsWithDuplicates(entries), []);
});
