// specs/server-test-isolation.md rule 20 (audit R39-S1, 2026-11-10) — rule 18 for the control-plane suite: an instance a
// test file starts through the `local` process driver (detached, like a systemd unit) never outlives that file, and
// neither does the file's temp tree. The file is cut off (SIGKILL, as `--test-timeout`, the exit watchdog or a kill end
// it) or exits without its cleanup: the instance stops within seconds and the file's temp root is gone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PRELOAD = path.join(__dirname, 'setup', 'fileTempRoot.js');
const DRIVER = path.join(__dirname, '..', 'utils', 'drivers', 'process-local.js');
const ENV = path.join(__dirname, '..', 'utils', 'instanceEnv.js');

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
async function until(check, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// A test file in miniature: under the preload, it starts one instance with the real `local` driver from a release
// whose server only idles, prints the instance's pid and its temp root, then ends as `how` says, its cleanup never run.
function fileStartingAnInstance(how) {
  return `
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const { createLocalProcessDriver } = require(${JSON.stringify(DRIVER)});
    const { writeEnv } = require(${JSON.stringify(ENV)});
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-h1-'));
    const releasesDir = path.join(base, 'releases');
    fs.mkdirSync(path.join(releasesDir, '9.0.0', 'server', 'src'), { recursive: true });
    fs.writeFileSync(path.join(releasesDir, '9.0.0', 'server', 'src', 'index.js'), 'setInterval(() => {}, 1000);');
    const inst = { dir: path.join(base, 'instances', 'aulnes'), envFile: path.join(base, 'envs', 'aulnes.env') };
    fs.mkdirSync(inst.dir, { recursive: true });
    writeEnv(inst.envFile, { GUESTFLOW_VERSION: '9.0.0' });
    const driver = createLocalProcessDriver({ releasesDir });
    driver.enableNow(inst).then(() => {
      const pid = Number(fs.readFileSync(path.join(inst.dir, 'instance.pid'), 'utf8'));
      console.log('instance ' + pid + ' root ' + os.tmpdir());
      ${how === 'exit' ? 'setTimeout(() => process.exit(1), 50);' : 'setInterval(() => {}, 1000);'}
    });`;
}

async function cutOff(how, outside) {
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', TMPDIR: outside, NODE_TEST_CONTEXT: 'child-v8' };
  const file = spawn(process.execPath, ['-r', PRELOAD, '-e', fileStartingAnInstance(how)], { stdio: ['ignore', 'pipe', 'inherit'], env });
  const exited = new Promise((resolve) => file.once('exit', resolve));
  const started = await new Promise((resolve, reject) => {
    let out = '';
    file.stdout.on('data', (chunk) => {
      out += chunk;
      const m = /instance (\d+) root (\S+)/.exec(out);
      if (m) resolve({ pid: Number(m[1]), root: m[2] });
    });
    exited.then((code) => reject(new Error(`the file stopped (${code}) before its instance was up`)));
  });
  if (how === 'kill') file.kill('SIGKILL');
  await exited;
  return started;
}

for (const how of ['kill', 'exit']) {
  test(`rule 20: a file ${how === 'kill' ? 'killed' : 'exiting without its cleanup'} takes its instance and its temp root with it`, { timeout: 60000 }, async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-exit-file-'));
    let started = null;
    try {
      started = await cutOff(how, outside);
      assert.ok(started.root.startsWith(fs.realpathSync(outside)) || started.root.startsWith(outside), started.root);
      assert.equal(await until(() => !alive(started.pid)), true, `instance ${started.pid} outlived its test file`);
      assert.equal(await until(() => !fs.existsSync(started.root)), true, `${started.root} outlived its test file`);
    } finally {
      if (started && alive(started.pid)) process.kill(started.pid, 'SIGKILL');
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
}

test('rule 20: npm test preloads the temp root, and the lifecycle integration test requires it first', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /--require \.\/src\/tests\/setup\/fileTempRoot\.js/);
  const source = fs.readFileSync(path.join(__dirname, 'hosting-lifecycle.integration.test.js'), 'utf8');
  assert.match(source, /^require\('\.\/setup\/fileTempRoot'\);$/m);
});
