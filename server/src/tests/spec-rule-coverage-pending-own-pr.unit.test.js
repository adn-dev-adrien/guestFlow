// specs/spec-rule-coverage.md rules 18 and 19 — a Pending rule is reported as pending even when a test cites it, and a spec
// « In progress — PR X » cannot keep a `> **Pending** — PR X` line.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', '..', '..', 'scripts', 'check-spec-coverage.mjs'));

const spec = (status, pendingOn) => [
  '# Une spec',
  '',
  '| Field | Value |',
  '|---|---|',
  `| **Status** | ${status} |`,
  '',
  '## 3. Functional rules',
  '',
  '1. **Livrée.** Elle est testée.',
  '2. **Plus tard.** Elle viendra.',
  `   > **Pending** — ${pendingOn}`,
  '## 4. Architecture',
].join('\n');

test('rule 18 — a Pending rule that a test cites stays pending, is not covered, and is listed as cited', async () => {
  const { parseSpecRules, buildCoverage } = await load();
  const rules = parseSpecRules(spec('In progress — PR A of 3', 'PR B'));
  const cov = buildCoverage(new Map([['x', rules]]), [{ spec: 'x', rule: '1', file: 't' }, { spec: 'x', rule: '2', file: 't' }]);
  assert.equal(cov.specs[0].pending, 1);
  assert.equal(cov.specs[0].covered, 1);
  assert.deepEqual(cov.specs[0].pendingCited, ['2']);
  assert.deepEqual(cov.specs[0].missing, []);
});

test('rule 18 — an uncited Pending rule is pending and not missing, as before', async () => {
  const { parseSpecRules, buildCoverage } = await load();
  const cov = buildCoverage(new Map([['x', parseSpecRules(spec('In progress — PR A', 'PR B'))]]), [{ spec: 'x', rule: '1', file: 't' }]);
  assert.deepEqual([cov.specs[0].pending, cov.specs[0].covered, cov.specs[0].pendingCited, cov.specs[0].missing], [1, 1, [], []]);
});

test('rule 19 — « In progress — PR A » with a Pending line naming PR A fails; PR B, a later PR or Implemented do not', async () => {
  const { specsPendingOnTheirOwnPr } = await load();
  assert.deepEqual(specsPendingOnTheirOwnPr([['a.md', spec('In progress — PR A of 3', 'PR A')]]), [{ spec: 'a', pr: 'A', rules: ['2'] }]);
  assert.deepEqual(specsPendingOnTheirOwnPr([['a.md', spec('In progress — PR A', 'PR A (the plugin)')]]), [{ spec: 'a', pr: 'A', rules: ['2'] }]);
  assert.deepEqual(specsPendingOnTheirOwnPr([['b.md', spec('In progress — PR A', 'PR B')]]), []);
  assert.deepEqual(specsPendingOnTheirOwnPr([['b.md', spec('In progress — PR B', 'PR B')]]), [{ spec: 'b', pr: 'B', rules: ['2'] }]);
  assert.deepEqual(specsPendingOnTheirOwnPr([['c.md', spec('In progress — PR B', 'PR A')]]), []);
  assert.deepEqual(specsPendingOnTheirOwnPr([['d.md', spec('Implemented', 'PR A')]]), [], 'rule 18 judges that case');
  assert.deepEqual(specsPendingOnTheirOwnPr([['e.md', spec('In progress', 'PR A')]]), [], 'no own PR named');
  assert.deepEqual(specsPendingOnTheirOwnPr([['README.md', spec('In progress — PR A', 'PR A')]]), []);
});

test('rule 19 — the real tree carries no spec pending on its own PR', async () => {
  const fs = require('node:fs');
  const dir = path.join(__dirname, '..', '..', '..', 'specs');
  const { specsPendingOnTheirOwnPr } = await load();
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
  assert.deepEqual(specsPendingOnTheirOwnPr(entries), []);
});
