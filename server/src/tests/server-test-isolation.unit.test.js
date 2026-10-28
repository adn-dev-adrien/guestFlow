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
