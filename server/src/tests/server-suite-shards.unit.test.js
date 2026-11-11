// specs/server-test-isolation.md rule 19 (audit R37-S1) — the PR server suite runs in two shards, each under the
// 15-minute cap: one process per file run one after another took 13.8 min, and 802b17ac was cancelled at the cap.
// A shard is the package's own `npm test` with `--test-shard=N/M` set after `--test`; the shards together run every
// file once, and none twice. Never a test hidden: the split is by file, the reporters and caps unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(ROOT, 'scripts', 'test-runner', 'run-test-shard.mjs');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const jobBlock = (workflow, name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name}`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};

test('rule 19: the PR server job is a matrix of two shards, each under its 15-minute cap, through npm test\'s own command', () => {
  const server = jobBlock(read('.github/workflows/unit-tests.yml'), 'server');
  assert.match(server, /shard: \[1, 2\]/);
  assert.match(server, /fail-fast: false/);
  assert.match(server, /timeout-minutes: 15\n/);
  assert.match(server, /cd server && node \.\.\/scripts\/test-runner\/run-test-shard\.mjs \$\{\{ matrix\.shard \}\}\/2\n/);
  assert.doesNotMatch(server, /npm test/);
});

function withPackage(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-shards-'));
  try {
    for (let i = 1; i <= 5; i += 1) fs.writeFileSync(path.join(dir, `f${i}.test.js`), `require('node:test')('file ${i}', () => {});\n`);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test --test-concurrency=1 --test-reporter=tap "*.test.js"' } }));
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const runShard = (dir, shard) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [RUNNER, shard], { cwd: dir, encoding: 'utf8', env, timeout: 60000 });
};
const ranIn = (out) => [...out.matchAll(/^ok \d+ - file (\d)/gm)].map((m) => Number(m[1]));

test('rule 19: the shards run every file once, and none twice', () => {
  withPackage((dir) => {
    const first = runShard(dir, '1/2');
    const second = runShard(dir, '2/2');
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const a = ranIn(first.stdout);
    const b = ranIn(second.stdout);
    assert.ok(a.length > 0 && b.length > 0, `${a} | ${b}`);
    assert.deepEqual([...a, ...b].sort(), [1, 2, 3, 4, 5]);
  });
});

test('rule 19: a failing test fails its shard; a malformed shard is refused before anything runs', () => {
  withPackage((dir) => {
    fs.writeFileSync(path.join(dir, 'f1.test.js'), "require('node:test')('file 1', () => { throw new Error('red'); });\n");
    const statuses = ['1/2', '2/2'].map((s) => runShard(dir, s).status);
    assert.ok(statuses.includes(1), `one shard holds the red file: ${statuses}`);
    for (const bad of ['', '0/2', '3/2', '1-2', 'a/b']) assert.equal(runShard(dir, bad).status, 2, bad);
  });
});
