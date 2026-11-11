// specs/plugin-removal-resilience.md rule 7 — the removal workflow runs nightly and on demand only,
// builds its matrix from the folders, never touches a self-hosted runner and leaves the pull-request
// checks alone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'plugin-removal.yml'), 'utf8');
const code = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

test('rule 7: the workflow is triggered by a schedule and by hand, never by a pull request or a push', () => {
  const on = code.slice(code.indexOf('\non:'), code.indexOf('\nconcurrency:'));
  assert.match(on, /schedule:/);
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /pull_request|push:/);
});

test('rule 7: one cell per plugin, the matrix being the list the folders give', () => {
  assert.match(code, /node scripts\/plugin-removal\.mjs list/);
  assert.match(code, /plugin: \$\{\{ fromJSON\(needs\.list\.outputs\.plugins\) \}\}/);
  assert.match(code, /name: 'removal: \$\{\{ matrix\.plugin \}\}'/);
  assert.match(code, /plugin-removal\.mjs cell "\$\{\{ matrix\.plugin \}\}" --in-place/);
});

test('rule 7: a failing night opens or comments on one issue, and only a scheduled run does', () => {
  assert.match(code, /needs: \[list, removal, sweep\]/);
  assert.match(code, /needs\.list\.result == 'failure'/);
  assert.match(code, /github\.event_name == 'schedule'/);
  assert.match(code, /Plugin removal matrix failing/);
  assert.match(code, /issues: write/);
});

test('review follow-up: GitHub-hosted runners only, eight cells at a time, and the server suite stays serial', () => {
  assert.doesNotMatch(code, /self-hosted/);
  assert.match(code, /max-parallel: 8/);
  assert.match(code, /runs-on: ubuntu-latest/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /--test-concurrency=1/);
});
