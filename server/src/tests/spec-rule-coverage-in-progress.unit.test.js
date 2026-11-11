// specs/spec-rule-coverage.md rule 18 — a spec delivered over several PRs: « In progress » counts as delivered
// for code, a `> **Pending** — <PR>` line defers a rule's test, and Pending dies with the In progress status.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check-spec-coverage.mjs');
const load = () => import(SCRIPT);

const spec = (status, extra = '') => [
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
  '   > **Pending** — PR B',
  '3. **Sans test.** Déclarée.',
  '   > **Sans test** — pas testable',
  extra,
  '## 4. Architecture',
].join('\n');

test('rule 18 — a Pending line is read with its reason, apart from Sans test', async () => {
  const { parseSpecRules } = await load();
  const rules = parseSpecRules(spec('In progress — PR A of 3'));
  assert.deepEqual(rules.map((r) => [r.id, r.pending, r.exempt]), [['1', false, false], ['2', true, false], ['3', false, true]]);
  assert.equal(rules[1].pendingReason, 'PR B');
});

test('rule 18 — In progress is delivered for code: a citation of the spec is not refused', async () => {
  const { isUndelivered, isInProgress, exemptCitations, specTransitions } = await load();
  assert.equal(isInProgress(spec('In progress — PR A of 3')), true);
  assert.equal(isInProgress(spec('Approved')), false);
  assert.equal(isUndelivered(spec('In progress — PR A of 3')), false);
  const { exempt, delivered } = specTransitions([{ name: 'x', before: spec('Approved'), now: spec('In progress — PR A of 3') }]);
  assert.equal(exempt.has('x'), false);
  assert.equal(delivered.has('x'), true, 'moving from Approved to In progress delivers the spec');
  const diff = '+++ b/server/src/a.js\n+// see specs/x.md\n';
  assert.deepEqual(exemptCitations(diff, exempt), []);
});

test('rule 18 — a Pending rule is exempt from the citation, an unmarked one is not, and the count is apart', async () => {
  const { parseSpecRules, gateVerdict, buildCoverage } = await load();
  const rules = parseSpecRules(spec('In progress'));
  const added = rules.map((r) => ({ spec: 'x', rule: r.id, exempt: r.exempt, pending: r.pending }));
  const verdict = gateVerdict({ addedRules: added, citedAfter: new Set() });
  assert.deepEqual(verdict.failures, [{ spec: 'x', rule: '1' }]);
  assert.equal(gateVerdict({ addedRules: added, citedAfter: new Set(['x:1']) }).ok, true);
  const cov = buildCoverage(new Map([['x', rules]]), [{ spec: 'x', rule: '1', file: 't' }]);
  assert.equal(cov.specs[0].pending, 1);
  assert.deepEqual(cov.specs[0].missing, []);
  assert.equal(cov.specs[0].covered, 2, 'Pending is not counted as covered');
});

test('rule 18 — rulesChangedInDiff carries the pending flag of a rule added by the diff', async () => {
  const { rulesChangedInDiff, specsFromMarkdown } = await load();
  const specsNow = specsFromMarkdown([['x.md', spec('In progress')]]);
  const diff = '+++ b/specs/x.md\n+2. **Plus tard.** Elle viendra.\n';
  const { addedRules } = rulesChangedInDiff(diff, specsNow);
  assert.deepEqual(addedRules.map((r) => [r.rule, r.pending]), [['2', true]]);
});

test('rule 18 — a delivered spec that keeps a Pending line fails; In progress, Draft and Approved do not', async () => {
  const { specsWithStalePending } = await load();
  const stale = specsWithStalePending([['a.md', spec('Implemented')], ['b.md', spec('In progress — PR A')], ['c.md', spec('Approved')], ['d.md', spec('Draft')]]);
  assert.deepEqual(stale, [{ spec: 'a', rules: ['2'] }]);
  assert.deepEqual(specsWithStalePending([['e.md', spec('Implemented — superseded by `f.md`')]]), []);
});
