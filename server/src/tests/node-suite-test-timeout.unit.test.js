// specs/server-test-isolation.md rule 5 — a test file that never ends fails on its timeout instead of
// hanging the job until the CI cancels it without naming it. Node 22 applies `--test-timeout` to each
// FILE, Node 24 (CI) to each TEST; the exit watchdog ends the child that a timed-out test leaves holding an
// open handle. `--test-force-exit` did that job until audit R9 M-1 caught it ending files before their last
// tests (rule 10), so it must not come back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, SUITES, testScript, withTestFile, runLikeSuite } = require('./nodeSuiteScriptFixture');

const timeoutOf = (script) => {
  const m = script.match(/--test-timeout=(\d+)/);
  return m ? Number(m[1]) : null;
};

test('rule 5: the server suite runs under a 60 s timeout, the control-plane one under 180 s', () => {
  assert.equal(timeoutOf(testScript('server/package.json')), 60000);
  // Its lifecycle integration test gives itself 170 s; the file cap must not cut that budget.
  assert.equal(timeoutOf(testScript('control-plane/server/package.json')), 180000);
  const integration = fs.readFileSync(path.join(root, 'control-plane/server/src/tests/hosting-lifecycle.integration.test.js'), 'utf8');
  const own = Math.max(...[...integration.matchAll(/timeout: (\d+)/g)].map((m) => Number(m[1])));
  assert.ok(own < 180000, `the integration test's own ${own} ms fits under the file cap`);
});

test('rule 5: both suites preload the exit watchdog and never pass --test-force-exit', () => {
  for (const pkg of SUITES) {
    const script = testScript(pkg);
    assert.doesNotMatch(script, /--test-force-exit/, pkg);
    const preload = script.match(/--require (\S*test-exit-watchdog\.cjs)/);
    assert.ok(preload, `${pkg} preloads the watchdog`);
    assert.ok(fs.existsSync(path.join(root, path.dirname(pkg), preload[1])), `${pkg}: ${preload[1]} exists`);
  }
});

for (const pkg of SUITES) {
  test(`rule 5: under ${pkg}'s flags a test that never settles fails, is named, and the run ends`, () => {
    withTestFile([
      "const test = require('node:test');",
      "test('a server that never answers', () => new Promise(() => { setInterval(() => {}, 1000); }));",
    ].join('\n'), (file) => {
      const run = runLikeSuite(pkg, file);
      assert.equal(run.error, undefined, 'the run ended by itself');
      assert.notEqual(run.status, 0, run.output);
      // Node 22 names the file, Node 24 the test.
      assert.match(run.output, /✖ (.*probe\.test\.js|a server that never answers)/);
      assert.match(run.output, /test timed out after 300ms/);
      assert.ok(run.elapsedMs < 20000, `ended after ${run.elapsedMs} ms`);
    });
  });

  test(`rule 5: under ${pkg}'s flags a file whose tests pass but leave a handle open fails, named, within the grace`, () => {
    withTestFile([
      "const test = require('node:test');",
      "test('starts an interval and returns', () => { setInterval(() => {}, 1000); });",
    ].join('\n'), (file) => {
      // A file limit above the grace, as in the scripts, or Node 22's file timeout fires first.
      const run = runLikeSuite(pkg, file, { timeoutMs: 15000, graceMs: 300 });
      assert.equal(run.error, undefined, 'the run ended by itself');
      assert.notEqual(run.status, 0, run.output);
      assert.match(run.output, /probe\.test\.js is still running 300 ms after its last test/);
      assert.ok(run.elapsedMs < 20000, `ended after ${run.elapsedMs} ms`);
    });
  });
}
