// specs/spec-rule-coverage.md rule 13 — a superseded spec no longer describes the product: its rules
// leave the report and never block the gate. Found when master's superseded
// finance-exercise-overview-charts spec reached `inte/plugins` (#649) with its tests already deleted.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check-spec-coverage.mjs');
const load = () => import(SCRIPT);

const spec = (status) => [
  '# Une spec',
  '',
  '| Field | Value |',
  '|---|---|',
  `| **Status** | ${status} |`,
  '',
  '## 3. Functional rules',
  '',
  '1. **Une règle.** Elle fait quelque chose.',
  '',
  '## 4. Architecture',
].join('\n');

test('rule 13 — the Status line decides, whatever the wording around « superseded »', async () => {
  const { isSuperseded } = await load();
  assert.equal(isSuperseded(spec('Implemented — superseded by `finance-dashboard-redesign.md`')), true);
  assert.equal(isSuperseded(spec('Superseded')), true);
  assert.equal(isSuperseded(spec('Implemented')), false);
  assert.equal(isSuperseded(`${spec('Implemented')}\n\n> This spec superseded an older one.`), false,
    'a mention outside the Status line does not count');
});

test('rule 13 — a superseded spec has no rules: absent from the report, never failing the gate', async () => {
  const { specsFromMarkdown, rulesChangedInDiff } = await load();
  const specs = specsFromMarkdown([
    ['old.md', spec('Implemented — superseded by `new.md`')],
    ['new.md', spec('Implemented')],
  ]);
  assert.deepEqual([...specs.keys()], ['new']);
  const diff = [
    '+++ b/specs/old.md', '+1. **Une règle.** Elle fait quelque chose.',
    '+++ b/specs/new.md', '+1. **Une règle.** Elle fait quelque chose.',
  ].join('\n');
  const { addedRules } = rulesChangedInDiff(diff, specs);
  assert.deepEqual(addedRules.map((r) => r.spec), ['new']);
});
