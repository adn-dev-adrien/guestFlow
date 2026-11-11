// specs/self-update-and-releases.md rule 56 — GitHub refuses a release body above 125,000 characters (the 4.0.0 section
// folded to 408,000). `--check-digest`, which the release workflow's verify job runs, fails on a section over the limit,
// measuring the body exactly as the workflow's awk extracts it; the preview and `--release` warn.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-changelog.mjs');
const load = () => import(pathToFileURL(SCRIPT).href);

const section = (version, bulletChars) => [
  '## [Unreleased]', '', `## [${version}] - 2026-11-11`, '', '### Summary', '- Un résumé.', '', '### Fixed',
  `- ${'x'.repeat(bulletChars)}`, '', '## [3.21.0] - 2026-11-04', '', '### Fixed', '- Older.', '',
].join('\n');

test('rule 56 — releaseBodyOf is the workflow awk: after the opening line, up to the next `## [`, newline per line', async () => {
  const { releaseBodyOf } = await load();
  const text = section('4.0.0', 10);
  assert.equal(releaseBodyOf(text, '4.0.0'), '\n### Summary\n- Un résumé.\n\n### Fixed\n- xxxxxxxxxx\n\n');
  assert.equal(releaseBodyOf(text, '9.9.9'), null);
  assert.equal(releaseBodyOf(text, '3.21.0'), '\n### Fixed\n- Older.\n');
});

test('rule 56 — the limit is 125,000 characters: at it the body passes, one over it fails with the way out', async () => {
  const { checkBodySize, RELEASE_BODY_MAX_CHARS } = await load();
  assert.equal(RELEASE_BODY_MAX_CHARS, 125000);
  assert.deepEqual(checkBodySize('a'.repeat(125000)), { ok: true, length: 125000, max: 125000, error: null });
  const over = checkBodySize('a'.repeat(125001));
  assert.equal(over.ok, false);
  assert.match(over.error, /125001 characters, GitHub accepts at most 125000/);
  assert.match(over.error, /docs\/changelog\/<version>-detail\.md/);
});

function run(args, cwdFiles) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-changelog-')));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'build-changelog.mjs'));
    fs.mkdirSync(path.join(dir, 'changelog.d'));
    for (const [name, content] of Object.entries(cwdFiles)) fs.writeFileSync(path.join(dir, name), content);
    return spawnSync(process.execPath, [path.join(dir, 'scripts', 'build-changelog.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('rule 56 — `--check-digest` fails on an over-long section and passes once it is condensed', () => {
  const tooLong = run(['--check-digest', '4.0.0'], { 'CHANGELOG.md': section('4.0.0', 130000) });
  assert.equal(tooLong.status, 1);
  assert.match(tooLong.stderr, /release body is not publishable/);
  assert.match(tooLong.stderr, /GitHub accepts at most 125000/);

  const fine = run(['--check-digest', '4.0.0'], { 'CHANGELOG.md': section('4.0.0', 4000) });
  assert.equal(fine.status, 0, fine.stderr);
  assert.match(fine.stdout, /release body \d+\/125000 characters/);
});

test('rule 56 — the preview and `--release` warn about an over-long result without failing', () => {
  const bullets = Array.from({ length: 14 }, (_, i) => `- ${String(i).repeat(10000)}`).join('\n');
  const preview = run([], { 'CHANGELOG.md': '## [Unreleased]\n\n', 'changelog.d/fixed--huge.md': bullets });
  assert.equal(preview.status, 0);
  assert.match(preview.stderr, /WARNING: the pending changelog is \d+ characters, over the 125000/);

  // date-literal-ok: a date written into a throwaway CHANGELOG fixture
  const released = run(['--release', '4.0.0', '2026-11-11'], { 'CHANGELOG.md': '## [Unreleased]\n\n', 'changelog.d/fixed--huge.md': bullets });
  assert.equal(released.status, 0);
  assert.match(released.stderr, /WARNING: the 4\.0\.0 section is \d+ characters/);
});

test('rule 56 — the release workflow extracts the body with the awk the guard reproduces', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /index\(\$0, ver\) == 1 \{ flag = 1; next \}/);
  assert.match(workflow, /node scripts\/build-changelog\.mjs --check-digest/);
});

test('rule 56 — a `detail--` fragment closes the folded section, after every category and with no heading', async () => {
  const { assemble } = await load();
  const out = assemble({ added: ['- A.'], migration: ['- M.'], detail: ['Full detail: `docs/changelog/9.9.9-detail.md`.'] });
  assert.equal(out, '### Added\n- A.\n\n### Migration\n- M.\n\nFull detail: `docs/changelog/9.9.9-detail.md`.');
  assert.equal(assemble({ fixed: ['- F.'] }), '### Fixed\n- F.');
});
