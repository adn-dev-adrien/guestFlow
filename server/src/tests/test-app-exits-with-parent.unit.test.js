// specs/server-test-isolation.md rule 18 (audit R37-S2) — an app a test file starts never outlives that file. The
// file is killed (here SIGKILL, as `--test-timeout` or the exit watchdog end it) before its `after` hook stops the
// app: the app child still exits within seconds, for the fuzz harness's fork (inputShapeApp) and for a spawned
// `src/index.js` preloading setup/exitWithParent.js through an 'ipc' slot (property-documents-private).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

async function gone(pid, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Runs `code` in a parent process that prints its app child's pid, kills that parent, and answers the child's pid. */
async function orphanOf(code) {
  const parent = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'], env: { PATH: process.env.PATH, TZ: 'Europe/Paris', NODE_ENV: 'test', GUESTFLOW_DISABLE_OUTBOUND: '1', DB_PATH: ':memory:' } });
  const pid = await new Promise((resolve, reject) => {
    let out = '';
    parent.stdout.on('data', (chunk) => {
      out += chunk;
      const m = /child (\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    parent.once('exit', (c) => reject(new Error(`parent stopped (${c}) before its child was up`)));
  });
  parent.removeAllListeners('exit');
  const exited = new Promise((resolve) => parent.once('exit', resolve));
  parent.kill('SIGKILL');
  await exited;
  return pid;
}

test('rule 18: the fuzz harness app exits when its test file is killed', { timeout: 90000 }, async () => {
  const harness = JSON.stringify(path.join(__dirname, 'inputShapeApp.js'));
  const pid = await orphanOf(`require(${harness}).startApp().then((app) => { console.log('child ' + app.pid); setInterval(() => {}, 1000); });`);
  try {
    assert.equal(await gone(pid), true, `inputShapeAppChild ${pid} outlived its parent`);
  } finally {
    if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

test('rule 18: a spawned src/index.js preloading exitWithParent exits when its test file is killed', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-exit-parent-'));
  const preload = JSON.stringify(path.join(__dirname, 'setup', 'exitWithParent.js'));
  const env = JSON.stringify({
    PATH: process.env.PATH, NODE_ENV: 'test', GUESTFLOW_DISABLE_OUTBOUND: '1', PORT: '0', GUESTFLOW_LISTEN_HOST: '127.0.0.1',
    DB_PATH: path.join(dir, 'g.db'), GUESTFLOW_UPLOADS_DIR: path.join(dir, 'uploads'), GUESTFLOW_LOCAL_ENV: path.join(dir, '.env.local'),
    GUESTFLOW_MAIL_OUTBOX: path.join(dir, 'outbox'), GUESTFLOW_SMTP_DETECT: 'off', GUESTFLOW_PLUGINS: 'sources',
  });
  const cwd = JSON.stringify(path.resolve(__dirname, '..', '..'));
  const pid = await orphanOf(`const c = require('node:child_process').spawn(process.execPath, ['-r', ${preload}, 'src/index.js'], { cwd: ${cwd}, env: ${env}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    console.log('child ' + c.pid); setInterval(() => {}, 1000);`);
  try {
    assert.equal(await gone(pid), true, `src/index.js ${pid} outlived its parent`);
  } finally {
    if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 18: property-documents-private spawns its app with the preload and an ipc slot', () => {
  const source = fs.readFileSync(path.join(__dirname, 'property-documents-private.unit.test.js'), 'utf8');
  assert.match(source, /spawn\(process\.execPath, \['-r', EXIT_WITH_PARENT, 'src\/index\.js'\]/);
  assert.match(source, /stdio: \['ignore', 'ignore', 'ignore', 'ipc'\]/);
});
