// specs/server-test-isolation.md rule 10 — a suite never reports green with tests of a file left unrun.
// Audit R9 M-1: under `--test-force-exit` a child exited 0 partway through `sas-commit.unit.test.js` on
// GitHub CI (8 898 tests reported instead of 8 910, job green). A child ending early is simulated here by
// a test calling `process.exit(0)`: plain `node --test` reports that run green, the suites' flags must not.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, SUITES, testScript, withTestFile, runLikeSuite } = require('./nodeSuiteScriptFixture');

const EXITS_AFTER_FIRST = [
  "const test = require('node:test');",
  "test('first', () => {});",
  "test('ends the process', async () => { await new Promise((r) => setTimeout(r, 200)); process.exit(0); });",
  "test('never run', () => {});",
  "test.describe('never run either', () => { test('inner', () => {}); });",
].join('\n');

test('rule 10: both suites keep the spec report on stdout and add the completeness reporter', () => {
  for (const pkg of SUITES) {
    const script = testScript(pkg);
    assert.match(script, /--test-reporter=spec --test-reporter-destination=stdout/, pkg);
    const reporter = script.match(/--test-reporter=(\S*test-completeness-reporter\.mjs) --test-reporter-destination=stderr/);
    assert.ok(reporter, `${pkg} adds the completeness reporter`);
    assert.ok(fs.existsSync(path.join(root, path.dirname(pkg), reporter[1])), `${pkg}: ${reporter[1]} exists`);
  }
});

test('rule 10: without the guard, a child ending early is a green run (the hole the guard closes)', () => {
  withTestFile(EXITS_AFTER_FIRST, (file) => {
    const run = runLikeSuite('server/package.json', file, { flags: ['--test', '--test-reporter=spec'] });
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /ℹ tests 1\b/);
  });
});

for (const pkg of SUITES) {
  test(`rule 10: under ${pkg}'s flags, a child ending early fails the run and names the tests it never ran`, () => {
    withTestFile(EXITS_AFTER_FIRST, (file) => {
      const run = runLikeSuite(pkg, file);
      assert.notEqual(run.status, 0, run.output);
      assert.match(run.stderr, /probe\.test\.js: 3 of 4 tests never reported/);
      for (const name of ['ends the process', 'never run', 'never run either']) {
        assert.match(run.stderr, new RegExp(`^  - ${name}$`, 'm'), name);
      }
      assert.doesNotMatch(run.stderr, /- first$/m);
    });
  });

  test(`rule 10: under ${pkg}'s flags, a child ending before reporting any test fails the run`, () => {
    withTestFile([
      "const test = require('node:test');",
      "test('ends the process at once', () => { process.exit(0); });",
      "test('never run', () => {});",
    ].join('\n'), (file) => {
      const run = runLikeSuite(pkg, file);
      assert.notEqual(run.status, 0, run.output);
      assert.match(run.stderr, /probe\.test\.js: no test reported/);
    });
  });

  test(`rule 10: under ${pkg}'s flags, a complete file with a skip, a todo, a suite and a failure is judged on its tests only`, () => {
    const body = [
      "const test = require('node:test');",
      "test('passes', () => {});",
      "test('skipped', { skip: true }, () => {});",
      "test('todo', { todo: true }, () => {});",
      "test.describe('suite', () => { test('inner', () => {}); });",
    ];
    withTestFile(body.join('\n'), (file) => {
      const run = runLikeSuite(pkg, file);
      assert.equal(run.status, 0, run.output);
      assert.doesNotMatch(run.stderr, /never reported|no test reported/);
    });
    withTestFile([...body, "test('fails', () => { throw new Error('boom'); });"].join('\n'), (file) => {
      const run = runLikeSuite(pkg, file);
      assert.notEqual(run.status, 0, run.output);
      assert.doesNotMatch(run.stderr, /never reported|no test reported/);
    });
  });
}
