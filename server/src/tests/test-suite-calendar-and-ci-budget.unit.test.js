// specs/server-test-isolation.md rules 6, 7 and 8, and specs/self-update-and-releases.md rule 52 (audit R8,
// 2026-10-30) — no test goes red with the calendar, a PR adding a literal date to a test is told so, and the
// unit suites fit their CI time budget.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'check-test-dates.mjs')).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const asAdded = (file, content) => ({ file, content, added: content.split('\n').map((text, i) => ({ line: i + 1, text })) });

test('rule 6: the « Sans acompte » suites, their fixture and the converted-devis suite carry no date the calendar will pass', async () => {
  const { findDateBombs, localToday } = await load();
  const files = [
    'server/src/tests/disabledAcompteLinkFixture.js',
    'server/src/tests/deposit-collected-by-link-kept-on-save.unit.test.js',
    'server/src/tests/deposit-link-paid-on-disabled-acompte.unit.test.js',
    'server/src/tests/deposit-link-paid-on-paid-solde.unit.test.js',
    'server/src/tests/deposit-due-date-and-override-history.unit.test.js',
    'server/src/tests/payment-links-converted-devis-double-payment.unit.test.js',
  ].map((f) => asAdded(f, read(f)));
  assert.deepEqual(findDateBombs({ files, today: localToday() }), []);
});

test('rule 7: a quoted date or a Date.UTC year from today on is named, with its file and line', async () => {
  const { findDateBombs } = await load();
  const content = [
    "const id = f.createStay({ startDate: '2027-11-02', endDate: '2027-11-05' });",
    'const day = (o) => new Date(Date.UTC(2027, 5, 1 + o)).toISOString();',
    "const paidAt = '2027-03-01T09:00:00Z';",
    "const old = '2026-10-29';",
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-10-30' }), [
    { file: 'server/src/tests/x.unit.test.js', line: 1, literal: '2027-11-02' },
    { file: 'server/src/tests/x.unit.test.js', line: 1, literal: '2027-11-05' },
    { file: 'server/src/tests/x.unit.test.js', line: 2, literal: 'Date.UTC(2027, …)' },
    { file: 'server/src/tests/x.unit.test.js', line: 3, literal: '2027-03-01' },
  ]);
});

test('rule 7: only the lines a PR adds are read, as the diff numbers them', async () => {
  const { parseAddedLines } = await load();
  const diff = [
    'diff --git a/server/src/tests/x.unit.test.js b/server/src/tests/x.unit.test.js',
    '--- a/server/src/tests/x.unit.test.js',
    '+++ b/server/src/tests/x.unit.test.js',
    '@@ -3,0 +4,2 @@ test(',
    "+const a = '2027-01-01';",
    "+const b = '2027-01-02';",
    '@@ -10 +12 @@',
    "-const c = '2027-01-03';",
    "+const c = '2027-01-04';",
    'diff --git a/gone.test.js b/gone.test.js',
    '--- a/gone.test.js',
    '+++ /dev/null',
  ].join('\n');
  assert.deepEqual(parseAddedLines(diff), [{
    file: 'server/src/tests/x.unit.test.js',
    added: [{ line: 4, text: "const a = '2027-01-01';" }, { line: 5, text: "const b = '2027-01-02';" }, { line: 12, text: "const c = '2027-01-04';" }],
  }]);
});

test('rule 7: the marker, a pinned clock, a comment, the far future and non-test files are not named', async () => {
  const { findDateBombs, isTestFile } = await load();
  const today = '2026-10-30';
  const marked = [
    "price({ date: '2027-07-14' }); // date-literal-ok: a pure function of its input",
    '// date-literal-ok: the season table is the subject',
    "const season = '2027-07-01';",
    "// The stay of '2027-01-01' is the one the audit saw.",
    "const far = '2099-06-01';",
  ].join('\n');
  const pinned = "vi.setSystemTime(new Date('2027-06-15T10:00:00'));\nconst d = '2027-06-20';";
  const nodePinned = "mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-05') });\nconst d = '2027-01-06';";
  assert.deepEqual(findDateBombs({
    today,
    files: [
      asAdded('server/src/tests/a.unit.test.js', marked),
      asAdded('client/src/pages/__tests__/B.test.jsx', pinned),
      asAdded('server/src/plugins/x/tests/c.unit.test.js', nodePinned),
      asAdded('server/src/utils/pricing.js', "const d = '2027-01-01';"),
      asAdded('server/src/tests/fixtures/stays.json', '{ "startDate": "2027-01-01" }'),
    ],
  }), []);
  assert.equal(isTestFile('e2e/booking.spec.js'), true);
  assert.equal(isTestFile('server/src/tests/disabledAcompteLinkFixture.js'), true);
  assert.equal(isTestFile('client/node_modules/x/tests/a.js'), false);
});

test('rule 7: the PR job warns on the lines it adds, and does not fail on them', () => {
  const workflow = read('.github/workflows/unit-tests.yml');
  const job = workflow.slice(workflow.indexOf('  spec-rules:'), workflow.indexOf('  server:'));
  assert.match(job, /node scripts\/check-test-dates\.mjs --base "origin\/\$\{\{ github\.base_ref \}\}"\n/);
  assert.doesNotMatch(job, /check-test-dates\.mjs[^\n]*--strict/);
});

const jobBlock = (workflow, name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name}`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};

test('rule 8: the PR client suite runs in three shards, the build and the bundle budget once', () => {
  const client = jobBlock(read('.github/workflows/unit-tests.yml'), 'client');
  assert.match(client, /shard: \[1, 2, 3\]/);
  assert.match(client, /fail-fast: false/);
  assert.match(client, /npm test -- --shard=\$\{\{ matrix\.shard \}\}\/3/);
  const budget = client.slice(client.indexOf('Initial JavaScript within its budget'));
  assert.match(budget, /^[^\n]*\n\s+if: matrix\.shard == 1\n/);
});

test('specs/self-update-and-releases.md rule 52: the release runs the server suite and three client shards side by side, and packages after all of them', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.doesNotMatch(workflow, /\n {2}tests:\n/);
  const server = jobBlock(workflow, 'server-tests');
  assert.match(server, /cd server && npm test/);
  assert.doesNotMatch(server, /client/);
  const client = jobBlock(workflow, 'client-tests');
  assert.match(client, /shard: \[1, 2, 3\]/);
  assert.match(client, /npm test -- --shard=\$\{\{ matrix\.shard \}\}\/3/);
  assert.match(client, /if: matrix\.shard == 1\n\s+run: cd client && npm run build/);
  assert.match(jobBlock(workflow, 'package'), /needs: \[verify, server-tests, client-tests, e2e\]/);
});
