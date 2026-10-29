// specs/server-test-isolation.md rules 1-2 — a test process never opens the checkout's own database:
// the preload gives it a temp DB_PATH and makes the default path throw.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const PRELOAD = path.join(__dirname, 'setup', 'isolateDefaultDb.js');
const SERVER_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DB = path.join(SERVER_ROOT, 'guestflow.db');

function inChild(code) {
  const env = { ...process.env };
  delete env.DB_PATH;
  const r = spawnSync(process.execPath, ['--require', PRELOAD, '-e', code], { cwd: SERVER_ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}

test('rule 1: the preload points DB_PATH at a fresh temp file, never the checkout database', () => {
  const out = inChild(`console.log(JSON.stringify({ db: process.env.DB_PATH, persistent: process.env.PERSISTENT_DB || null }))`);
  assert.notEqual(path.resolve(out.db), DEFAULT_DB);
  assert.ok(path.resolve(out.db).startsWith(require('os').tmpdir()) || path.resolve(out.db).startsWith(require('fs').realpathSync(require('os').tmpdir())));
  assert.equal(out.persistent, null);
});

test('rule 1: two test processes never share a database', () => {
  const a = inChild(`console.log(JSON.stringify(process.env.DB_PATH))`);
  const b = inChild(`console.log(JSON.stringify(process.env.DB_PATH))`);
  assert.notEqual(a, b);
});

test('rule 2: opening the default path (or its wal / shm) throws, :memory: and the temp file open', () => {
  const out = inChild(`
    const Database = require('better-sqlite3');
    const attempt = (f) => { try { new Database(f).close(); return 'opened'; } catch (e) { return /checkout's own database/.test(e.message) ? 'blocked' : e.message; } };
    console.log(JSON.stringify({
      def: attempt(${JSON.stringify(DEFAULT_DB)}),
      wal: attempt(${JSON.stringify(`${DEFAULT_DB}-wal`)}),
      memory: attempt(':memory:'),
      temp: attempt(process.env.DB_PATH),
    }));
  `);
  assert.deepEqual(out, { def: 'blocked', wal: 'blocked', memory: 'opened', temp: 'opened' });
});

test('rule 1: the temp folder is removed when the process exits', () => {
  const out = inChild(`
    const Database = require('better-sqlite3');
    new Database(process.env.DB_PATH).close();
    console.log(JSON.stringify(require('path').dirname(process.env.DB_PATH)));
  `);
  assert.equal(require('fs').existsSync(out), false);
});

function snapshot(file) {
  const fs = require('fs');
  return fs.existsSync(file) ? `${fs.statSync(file).mtimeMs}:${fs.statSync(file).size}` : null;
}

test('rule 4: a single file run with no preload never creates or touches the checkout state', () => {
  const touched = ['guestflow.db', 'guestflow.db-wal', 'guestflow.db-shm', '.env.local', 'uploads'].map((n) => path.join(SERVER_ROOT, n));
  const before = touched.map(snapshot);
  const env = { ...process.env };
  for (const k of ['DB_PATH', 'PERSISTENT_DB', 'GUESTFLOW_LOCAL_ENV', 'GUESTFLOW_UPLOADS_DIR', 'NODE_TEST_CONTEXT']) delete env[k];
  const r = spawnSync(process.execPath, ['--test', path.join('src', 'tests', 'settings-model.unit.test.js')], { cwd: SERVER_ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(touched.map(snapshot), before);
});

test('rule 4: under the test runner, database.js, the secrets file and the uploads folder default to a temp directory', () => {
  const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' };
  for (const k of ['DB_PATH', 'PERSISTENT_DB', 'GUESTFLOW_LOCAL_ENV', 'GUESTFLOW_UPLOADS_DIR']) delete env[k];
  const r = spawnSync(process.execPath, ['-e', `
    const db = require('./src/database');
    const ip = require('./src/utils/instancePaths');
    console.log(JSON.stringify({ db: db.dbPath, env: ip.localEnvPath(), up: ip.uploadsDir(), tmp: require('os').tmpdir() }));
  `], { cwd: SERVER_ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const tmp = require('fs').realpathSync(require('os').tmpdir());
  for (const p of Object.values(out)) assert.ok(path.resolve(p).startsWith(tmp) || path.resolve(p).startsWith(require('os').tmpdir()), p);
  assert.equal(path.dirname(out.tmp), path.dirname(path.dirname(out.db)), 'os.tmpdir() is inside the private directory');
  assert.equal(require('fs').existsSync(path.dirname(path.dirname(out.db))), false, 'removed on exit');
});
