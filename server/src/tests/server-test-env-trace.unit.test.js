// specs/server-test-isolation.md rule 13 (added 2026-11-02, review of #927): under `npm test` the preload
// replaces `process.env` with a Proxy that records, per test process, every name `src/` code reads and every
// place it takes the environment whole; at exit the runner fails the run on a name that is on neither list of
// `appEnvNames.js`. The runtime complement of rule 12's grep guard: it sees the forms that guard misses, but
// only where the suite runs the code against the real `process.env`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withTestFile, runLikeSuite } = require('./nodeSuiteScriptFixture');

const SERVER_ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, 'setup', 'isolateDefaultDb.js');
const TRACE = path.join(__dirname, 'setup', 'envTrace.js');
const DIR_VAR = 'GUESTFLOW_TEST_ENV_TRACE_DIR';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-env-trace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function node(args, env) {
  const r = spawnSync(process.execPath, args, { cwd: SERVER_ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').pop();
}

// A fake `src/` whose files read the environment in each way the trace must see, or must leave alone.
function plantTree(root) {
  const src = path.join(root, 'src');
  write(src, 'utils/probe.js', [
    'const env = process.env;',
    'module.exports = () => [',
    '  env.UNLISTED_BY_NAME,',
    "  'UNLISTED_BY_IN' in process.env,",
    "  (1 ? process.env : {})['UNLISTED_' + 'BUILT'],",
    '  process.env.PORT,',
    '  process.env.GUESTFLOW_FLAG,',
    '  { ...process.env },',
    "  require('node:tty').WriteStream.prototype.getColorDepth.call({}),",
    "  require('node:child_process').execFileSync(process.execPath, ['-e', '']),",
    '];',
  ].join('\n'));
  write(src, 'tests/helper.js', 'module.exports = () => process.env.UNLISTED_IN_TESTS;');
  write(src, 'plugins/p/tests/helper.js', 'module.exports = () => process.env.UNLISTED_IN_PLUGIN_TESTS;');
  write(src, 'node_modules/lib/index.js', 'module.exports = () => process.env.UNLISTED_IN_A_PACKAGE;');
  write(src, 'utils/viaPackage.js', "module.exports = () => require('../node_modules/lib')();");
  return src;
}

test('rule 13 (2026-11-02): the trace records the names `src/` reads, by each form planted, and where it takes the environment whole, not what tests, packages or Node read', (t) => {
  const root = scratch(t);
  const src = plantTree(root);
  const dir = fs.mkdirSync(path.join(root, 'trace'), { recursive: true }) || path.join(root, 'trace');
  node(['-e', `
    require(${JSON.stringify(TRACE)}).install({ dir: ${JSON.stringify(dir)}, srcRoot: ${JSON.stringify(src)} });
    require(${JSON.stringify(path.join(src, 'utils/probe.js'))})();
    require(${JSON.stringify(path.join(src, 'utils/viaPackage.js'))})();
    require(${JSON.stringify(path.join(src, 'tests/helper.js'))})();
    require(${JSON.stringify(path.join(src, 'plugins/p/tests/helper.js'))})();
    void process.env.UNLISTED_IN_EVAL;
  `], { ...process.env, UNLISTED_BY_NAME: 'x', SOME_SHELL_VAR: 'y', FORCE_COLOR: '1' });

  const { unlisted, whole } = require(TRACE).collect(dir);
  assert.deepEqual(unlisted.map((u) => u.name).sort(), ['UNLISTED_BUILT', 'UNLISTED_BY_IN', 'UNLISTED_BY_NAME'], 'Node reading `FORCE_COLOR` for the app is no read of the app');
  assert.deepEqual(unlisted.find((u) => u.name === 'UNLISTED_BY_NAME').sites, ['utils/probe.js:3']);
  assert.deepEqual(unlisted.find((u) => u.name === 'UNLISTED_BY_IN').sites, ['utils/probe.js:4']);
  assert.deepEqual(whole, ['utils/probe.js:10', 'utils/probe.js:8'], 'the spread and the child spawned without `env` are whole takes; the names they copy are no read');
});

test('rule 13 (2026-11-02): the report fails on an unlisted name, naming where it is read, and lists the whole takes', (t) => {
  const { report } = require(TRACE);
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, '1.json'), JSON.stringify({
    file: 'src/tests/a.test.js', reads: { NEW_SHELL_KNOB: ['utils/x.js:4'], PORT: ['index.js:9'], GUESTFLOW_X: ['a.js:1'] }, whole: ['utils/localEnv.js:60'],
  }));
  fs.writeFileSync(path.join(dir, '2.json'), JSON.stringify({
    file: 'src/tests/b.test.js', reads: { NEW_SHELL_KNOB: ['utils/x.js:4'] }, whole: ['index.js:2'],
  }));
  const red = report(dir);
  assert.equal(red.ok, false);
  assert.match(red.text, /NEW_SHELL_KNOB.*utils\/x\.js:4/);
  assert.match(red.text, /src\/tests\/a\.test\.js/);
  assert.doesNotMatch(red.text, /PORT|GUESTFLOW_X/);
  assert.match(red.text, /index\.js:2/);
  assert.match(red.text, /utils\/localEnv\.js:60/);

  const greenDir = scratch(t);
  fs.writeFileSync(path.join(greenDir, '1.json'), JSON.stringify({ file: 'a', reads: { PORT: ['index.js:9'] }, whole: [] }));
  assert.equal(report(greenDir).ok, true);
  assert.equal(report(path.join(greenDir, 'missing')).ok, false, 'a trace that wrote nothing is no green trace');
});

test('rule 13 (2026-11-02): the proxy changes nothing the app or a test relies on', () => {
  const out = node(['-e', `
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const { spawnSync, execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-env-trace-b-'));
    require(${JSON.stringify(TRACE)}).install({ dir });
    const r = {};
    r.proxied = require('node:util').types.isProxy(process.env);
    process.env.SET_NUMBER = 1; r.coerced = process.env.SET_NUMBER;
    r.inAfterSet = 'SET_NUMBER' in process.env;
    r.listed = Object.keys(process.env).includes('SET_NUMBER');
    delete process.env.SET_NUMBER; r.afterDelete = process.env.SET_NUMBER ?? null; r.inAfterDelete = 'SET_NUMBER' in process.env;
    process.env.INHERITED = 'yes';
    r.inherited = execFileSync(process.execPath, ['-p', 'process.env.INHERITED'], { encoding: 'utf8' }).trim();
    r.envOption = spawnSync(process.execPath, ['-p', 'process.env.ONLY_HERE + "/" + (process.env.INHERITED ?? "-")'], { env: { ...process.env, ONLY_HERE: 'opt' }, encoding: 'utf8' }).stdout.trim();
    r.explicitEnv = spawnSync(process.execPath, ['-p', 'process.env.INHERITED ?? "-"'], { env: { PATH: process.env.PATH }, encoding: 'utf8' }).stdout.trim();
    process.env.TZ = 'Asia/Tokyo'; r.tz = new Date(0).getTimezoneOffset();
    fs.writeFileSync(path.join(dir, 'env.local'), 'FROM_LOCAL_FILE=loaded\\n');
    process.env.GUESTFLOW_LOCAL_ENV = path.join(dir, 'env.local');
    require('./src/utils/localEnv').loadLocalEnv(); r.localEnv = process.env.FROM_LOCAL_FILE;
    r.json = JSON.parse(JSON.stringify(process.env)).INHERITED;
    r.descriptor = Object.getOwnPropertyDescriptor(process.env, 'INHERITED').value;
    console.log(JSON.stringify(r));
  `], { ...process.env, TZ: 'UTC' });
  assert.deepEqual(JSON.parse(out), {
    proxied: true, coerced: '1', inAfterSet: true, listed: true, afterDelete: null, inAfterDelete: false,
    inherited: 'yes', envOption: 'opt/yes', explicitEnv: '-', tz: -540, localEnv: 'loaded', json: 'yes', descriptor: 'yes',
  });
});

test('rule 13 (2026-11-02): under the `npm test` flags the runner traces its test processes and fails on an unlisted name; nothing is traced outside it', () => {
  const probe = "require('node:test')('probe', () => { console.log('PROXIED=' + require('node:util').types.isProxy(process.env)); });";
  withTestFile(probe, (file) => {
    const run = runLikeSuite('server/package.json', file, { timeoutMs: 30000 });
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /PROXIED=true/);
    assert.match(run.output, /environment trace \(test processes: 1\): every name src\/ read is in appEnvNames\.js/);
  });
  const planted = `require('node:test')('probe', () => {
    const dir = process.env.${DIR_VAR};
    require('node:fs').writeFileSync(require('node:path').join(dir, 'planted.json'),
      JSON.stringify({ file: 'probe', reads: { NEW_SHELL_KNOB: ['utils/x.js:4'] }, whole: [] }));
  });`;
  withTestFile(planted, (file) => {
    const run = runLikeSuite('server/package.json', file, { timeoutMs: 30000 });
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /NEW_SHELL_KNOB, read at utils\/x\.js:4/);
    assert.match(run.output, /# fail 0|ℹ fail 0/, 'every test passed: the trace alone turns the run red');
  });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  assert.equal(node(['--require', PRELOAD, '-p', `require('node:util').types.isProxy(process.env) + ':' + (process.env.${DIR_VAR} ?? '-')`], env), 'false:-',
    'a process outside a runner is not traced, and hands no directory on');
  const childEnv = { ...process.env };
  delete childEnv[DIR_VAR];
  assert.equal(node(['--require', PRELOAD, '-p', "require('node:util').types.isProxy(process.env)"], childEnv), 'false', 'nor is a test process of a run that made no directory');
});

test('rule 13 (2026-11-02, review of #928): a runner without isolation is recognised in every spelling, and makes no directory', (t) => {
  const { isolationNone } = require(TRACE);
  for (const execArgv of [
    ['--test', '--test-isolation=none'], ['--test', '--experimental-test-isolation=none'],
    ['--test', '--test-isolation', 'none'], ['--test', '--experimental-test-isolation', 'none'],
  ]) assert.equal(isolationNone(execArgv), true, execArgv.join(' '));
  for (const execArgv of [
    ['--test'], ['--test', '--test-isolation=process'], ['--test', '--test-isolation', 'process'],
    ['--test', '--experimental-test-isolation', 'process'], ['--test', '--test-isolation'], ['--test', 'none'],
    ['--test', '--test-isolation=none', '--test-isolation', 'process'],
  ]) assert.equal(isolationNone(execArgv), false, execArgv.join(' '));

  const flag = spawnSync(process.execPath, ['--test-isolation=none', '-e', '0']).status === 0 ? '--test-isolation' : '--experimental-test-isolation';
  const dir = scratch(t);
  const probe = write(dir, 'probe.test.js', "require('node:test')('probe', () => { console.log('DIR=' + (process.env.GUESTFLOW_TEST_ENV_TRACE_DIR ?? '-')); });");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env[DIR_VAR];
  const r = spawnSync(process.execPath, ['--test', flag, 'none', '--require', PRELOAD, probe], { cwd: SERVER_ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DIR=-/);
  assert.doesNotMatch(r.stdout + r.stderr, /environment trace/);
});
