// specs/spec-rule-coverage.md rule 14 — a spec not delivered yet (Draft, or Approved straight from
// Draft) defers its rules; leaving Draft/Approved requires all of them; a delivered spec moved back to
// Draft is never exempt; a rename does not hide the transition; the merge-base is the reference; and
// code never ships citing a spec that is still exempt. Added for spec-first PRs (UI/UX review
// 2026-10-18, decision 8).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check-spec-coverage.mjs');
const load = () => import(SCRIPT);

const spec = (status, rules = ['1. **Une règle.**', '2. **Une autre.**', '> **Sans test** — cadrage.']) => [
  '# Une spec', '', '| Field | Value |', '|---|---|', `| **Status** | ${status} |`, '',
  '## 3. Functional rules', '', ...rules, '',
  '## 4. Architecture',
].join('\n');

test('rule 14 — Draft and Approved are « not delivered »; any other status is', async () => {
  const { isUndelivered, isDraft } = await load();
  assert.equal(isUndelivered(spec('Draft')), true);
  assert.equal(isUndelivered(spec('draft — pending Q1')), true);
  assert.equal(isUndelivered(spec('Approved')), true);
  assert.equal(isUndelivered(spec('Approved _(2026-09-24)_')), true);
  assert.equal(isUndelivered(spec('Implemented')), false);
  assert.equal(isUndelivered(spec('Implemented (was Approved)')), false);
  assert.equal(isUndelivered(`${spec('Implemented')}\n\nDraft notes below.`), false);
  assert.equal(isDraft(spec('Approved')), false);
  assert.equal(isDraft(spec('Draft')), true);
});

test('rule 14 — which spec is exempt, which is delivered', async () => {
  const { specTransitions } = await load();
  const { exempt, delivered } = specTransitions([
    { name: 'new-draft', before: null, now: spec('Draft') },
    { name: 'approved-now', before: spec('Draft'), now: spec('Approved') },
    { name: 'draft-edited', before: spec('Draft'), now: spec('Draft') },
    { name: 'legacy-approved', before: spec('Approved'), now: spec('Approved') },
    { name: 'demoted', before: spec('Implemented'), now: spec('Draft') },
    { name: 'shipped', before: spec('Draft'), now: spec('Implemented') },
    { name: 'shipped-from-approved', before: spec('Approved'), now: spec('Implemented') },
    { name: 'plain', before: spec('Implemented'), now: spec('Implemented') },
  ]);
  assert.deepEqual([...exempt].sort(), ['approved-now', 'draft-edited', 'new-draft']);
  assert.deepEqual([...delivered].sort(), ['shipped', 'shipped-from-approved']);
  assert.ok(!exempt.has('demoted'), 'moving a delivered spec back to Draft is not a way around the gate');
  assert.ok(!exempt.has('legacy-approved'), 'an already-Approved spec stays gated as before');
});

test('rule 14 — Approved does not block, Implemented blocks every uncovered rule', async () => {
  const { specsFromMarkdown, rulesChangedInDiff, applyDraftStatus, gateVerdict, specTransitions } = await load();
  const diff = ['+++ b/specs/ledger.md', '+1. **Une règle.**'].join('\n');

  const approved = specsFromMarkdown([['ledger.md', spec('Approved')]]);
  const tA = specTransitions([{ name: 'ledger', before: spec('Draft'), now: spec('Approved') }]);
  const a = applyDraftStatus(rulesChangedInDiff(diff, approved), { ...tA, specsNow: approved });
  assert.equal(gateVerdict({ ...a, citedAfter: new Set() }).ok, true);

  const impl = specsFromMarkdown([['ledger.md', spec('Implemented')]]);
  const tI = specTransitions([{ name: 'ledger', before: spec('Approved'), now: spec('Implemented') }]);
  const i = applyDraftStatus({ addedRules: [], modifiedRules: [{ spec: 'ledger', rule: '1' }] }, { ...tI, specsNow: impl });
  assert.deepEqual(i.addedRules.map((r) => `${r.rule}:${r.exempt}`), ['1:false', '2:true']);
  assert.deepEqual(i.modifiedRules, [], 'a delivered rule is judged as added, not merely warned');
  assert.deepEqual(gateVerdict({ ...i, citedAfter: new Set() }).failures, [{ spec: 'ledger', rule: '1' }]);
  assert.equal(gateVerdict({ ...i, citedAfter: new Set(['ledger:1']) }).ok, true);
});

test('rule 14 — a demoted spec is gated like any other', async () => {
  const { specsFromMarkdown, rulesChangedInDiff, applyDraftStatus, gateVerdict, specTransitions } = await load();
  const now = specsFromMarkdown([['ledger.md', spec('Draft', ['1. **Une règle.**', '3. **Nouvelle.**'])]]);
  const t = specTransitions([{ name: 'ledger', before: spec('Implemented'), now: spec('Draft') }]);
  const diff = ['+++ b/specs/ledger.md', '+3. **Nouvelle.**'].join('\n');
  const r = applyDraftStatus(rulesChangedInDiff(diff, now), { ...t, specsNow: now });
  assert.deepEqual(gateVerdict({ ...r, citedAfter: new Set() }).failures, [{ spec: 'ledger', rule: '3' }]);
});

test('rule 14 — code added outside specs/ and docs/ may not cite an exempt spec', async () => {
  const { exemptCitations } = await load();
  const diff = [
    '+++ b/server/src/utils/pendingFeature.js', '+// specs/some-pending-spec.md rule 3',
    '+++ b/docs/specs/some-pending-spec.html', '+<code>specs/some-pending-spec.md</code>',
    '+++ b/specs/other.md', '+see specs/some-pending-spec.md',
    '+++ b/client/src/x.jsx', '+// specs/clients.md rule 2', '-// specs/some-pending-spec.md removed line',
  ].join('\n');
  assert.deepEqual(exemptCitations(diff, new Set(['some-pending-spec'])),
    [{ file: 'server/src/utils/pendingFeature.js', spec: 'some-pending-spec' }]);
  assert.deepEqual(exemptCitations(diff, new Set()), []);
});

test('rule 14 — a renamed spec is read under its old path', async () => {
  const { parseNameStatus } = await load();
  assert.deepEqual(parseNameStatus([
    'R087\tspecs/old-name.md\tspecs/new-name.md',
    'M\tspecs/kept.md',
    'A\tspecs/brand-new.md',
    'D\tspecs/gone.md',
    'M\tspecs/sub/dir.md',
  ].join('\n')), [
    { path: 'specs/new-name.md', from: 'specs/old-name.md' },
    { path: 'specs/kept.md', from: 'specs/kept.md' },
    { path: 'specs/brand-new.md', from: null },
  ]);
});

// End to end on a throw-away repository: the CLI, real git, a rename and a moving base branch.
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-gate-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'check-spec-coverage.mjs'));
  git('init', '-q', '-b', 'main');
  const gate = () => spawnSync(process.execPath, ['scripts/check-spec-coverage.mjs', '--changed', '--base', 'main'], { cwd: dir, encoding: 'utf8' });
  return { dir, git, write, gate };
}

test('rule 14 — git mv + leaving Draft in the same PR still requires every rule', () => {
  const r = repo();
  r.write('specs/a.md', spec('Draft', ['1. **Une règle.**']));
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.git('checkout', '-qb', 'pr');
  r.git('mv', 'specs/a.md', 'specs/b.md');
  r.write('specs/b.md', spec('Implemented', ['1. **Une règle.**']));
  r.git('add', '-A'); r.git('commit', '-qm', 'rename and ship');
  const out = r.gate();
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /specs\/b\.md règle 1/);
});

test('rule 14 — the base is read at the merge-base, not at the tip of the base branch', () => {
  const r = repo();
  r.write('specs/a.md', spec('Draft', ['1. **Une règle.**']));
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.git('checkout', '-qb', 'pr');
  r.write('specs/a.md', spec('Implemented', ['1. **Une règle.**']));
  r.git('add', '-A'); r.git('commit', '-qm', 'ship');
  r.git('checkout', '-q', 'main');
  r.git('rm', '-q', 'specs/a.md'); r.git('commit', '-qm', 'main moves on');
  r.git('checkout', '-q', 'pr');
  const out = r.gate();
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /specs\/a\.md règle 1/);
});

test('rule 14 — a new Draft spec passes; code citing it in the same PR does not', () => {
  const r = repo();
  r.write('README', 'x'); r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.git('checkout', '-qb', 'pr');
  r.write('specs/a.md', spec('Draft', ['1. **Une règle.**']));
  r.write('docs/specs/a.html', '<code>specs/a.md</code>');
  r.git('add', '-A'); r.git('commit', '-qm', 'spec');
  let out = r.gate();
  assert.equal(out.status, 0, out.stdout + out.stderr);
  r.write('server/src/a.js', '// specs/a.md rule 1\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'code');
  out = r.gate();
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /server\/src\/a\.js cite specs\/a\.md/);
});
