// specs/server-test-isolation.md rule 5 — a test file that never ends fails on its timeout instead of
// hanging the job until the CI cancels it without naming it. Node 22 applies `--test-timeout` to each
// FILE, Node 24 (CI) to each TEST; `--test-force-exit` ends the child that a timed-out test leaves
// holding an open handle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..', '..');
const testScript = (pkg) => JSON.parse(fs.readFileSync(path.join(root, pkg), 'utf8')).scripts.test;
const timeoutOf = (script) => {
  const m = script.match(/--test-timeout=(\d+)/);
  return m ? Number(m[1]) : null;
};

test('rule 5: the server suite runs under a 60 s timeout, the control-plane one under 180 s', () => {
  assert.equal(timeoutOf(testScript('server/package.json')), 60000);
  for (const pkg of ['server/package.json', 'control-plane/server/package.json']) {
    assert.match(testScript(pkg), /--test-force-exit/, pkg);
  }
  // Its lifecycle integration test gives itself 170 s; the file cap must not cut that budget.
  assert.equal(timeoutOf(testScript('control-plane/server/package.json')), 180000);
  const integration = fs.readFileSync(path.join(root, 'control-plane/server/src/tests/hosting-lifecycle.integration.test.js'), 'utf8');
  const own = Math.max(...[...integration.matchAll(/timeout: (\d+)/g)].map((m) => Number(m[1])));
  assert.ok(own < 180000, `the integration test's own ${own} ms fits under the file cap`);
});

test('rule 5: under --test-timeout and --test-force-exit a test that never settles fails, is named, and the run ends', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-test-timeout-'));
  try {
    const file = path.join(dir, 'hangs.test.js');
    fs.writeFileSync(file, [
      "const test = require('node:test');",
      "test('a server that never answers', () => new Promise(() => { setInterval(() => {}, 1000); }));",
    ].join('\n'));
    // The nested runner must not think it is a child of this one, or it reports in the parent's protocol.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const started = Date.now();
    const run = spawnSync(process.execPath, ['--test', '--test-timeout=300', '--test-force-exit', '--test-reporter=tap', file], {
      encoding: 'utf8', timeout: 30000, env,
    });
    assert.equal(run.error, undefined, 'the run ended by itself');
    assert.notEqual(run.status, 0);
    // Node 22 names the file, Node 24 the test.
    assert.match(run.stdout, /not ok 1 - (.*hangs\.test\.js|a server that never answers)/);
    assert.match(run.stdout, /test timed out after 300ms/);
    assert.ok(Date.now() - started < 20000, `ended after ${Date.now() - started} ms`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
