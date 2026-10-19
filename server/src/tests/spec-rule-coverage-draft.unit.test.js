// specs/spec-rule-coverage.md rule 14 — a Draft spec is not delivered yet: its rules wait, and the PR
// that takes it out of Draft must cover all of them. Added for spec-first PRs (UI/UX review
// 2026-10-18, decision 8).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check-spec-coverage.mjs');
const load = () => import(SCRIPT);

const spec = (status) => [
  '# Une spec', '', '| Field | Value |', '|---|---|', `| **Status** | ${status} |`, '',
  '## 3. Functional rules', '', '1. **Une règle.**', '2. **Une autre.**', '> **Sans test** — cadrage.', '',
  '## 4. Architecture',
].join('\n');

test('rule 14 — only a Status line starting with « Draft » is a draft', async () => {
  const { isDraft } = await load();
  assert.equal(isDraft(spec('Draft')), true);
  assert.equal(isDraft(spec('draft — pending Q1')), true);
  assert.equal(isDraft(spec('Implemented')), false);
  assert.equal(isDraft(spec('Approved (was a Draft)')), false);
  assert.equal(isDraft(`${spec('Implemented')}\n\nDraft notes below.`), false);
});

test('rule 14 — rules added to a Draft spec do not block the gate', async () => {
  const { specsFromMarkdown, rulesChangedInDiff, applyDraftStatus, gateVerdict } = await load();
  const specs = specsFromMarkdown([['ledger.md', spec('Draft')], ['other.md', spec('Implemented')]]);
  const diff = ['+++ b/specs/ledger.md', '+1. **Une règle.**', '+++ b/specs/other.md', '+1. **Une règle.**'].join('\n');
  const changed = applyDraftStatus(rulesChangedInDiff(diff, specs), { drafts: new Set(['ledger']) });
  assert.deepEqual(changed.addedRules.map((r) => r.spec), ['other'], 'the non-draft spec is still gated');
  assert.equal(gateVerdict({ ...changed, citedAfter: new Set() }).ok, false);
});

test('rule 14 — leaving Draft makes every rule of the spec count as added, exemptions kept', async () => {
  const { specsFromMarkdown, applyDraftStatus, gateVerdict } = await load();
  const specs = specsFromMarkdown([['ledger.md', spec('Implemented')]]);
  const changed = applyDraftStatus({ addedRules: [], modifiedRules: [{ spec: 'ledger', rule: '1' }] },
    { promoted: new Map([['ledger', specs.get('ledger')]]) });
  assert.deepEqual(changed.addedRules.map((r) => `${r.rule}:${r.exempt}`), ['1:false', '2:true']);
  assert.deepEqual(changed.modifiedRules, [], 'a promoted rule is judged as added, not merely warned');
  const verdict = gateVerdict({ ...changed, citedAfter: new Set() });
  assert.deepEqual(verdict.failures, [{ spec: 'ledger', rule: '1' }]);
  assert.equal(gateVerdict({ ...changed, citedAfter: new Set(['ledger:1']) }).ok, true);
});
