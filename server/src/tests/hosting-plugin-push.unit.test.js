// specs/hosting-h1-fleet-runtime.md rule 11 — on the instance side of a plugin push: the console runs
// the instance's own `scripts/switch-plugin-package.js` on a package of its registry (same checks as
// a download, then the row and `current`), `--sync` follows the row again after a rollback, and the
// health check asks `pluginHealth` whether the pushed version loaded.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const SERVER = path.join(__dirname, '..', '..');
const SWITCH = path.join(SERVER, 'scripts', 'switch-plugin-package.js');
const FIRST_ADMIN = path.join(SERVER, 'scripts', 'create-first-admin.js');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function makePackage(dir, id, version, extra = {}) {
  const src = fs.mkdtempSync(path.join(dir, 'pkg-'));
  const manifest = {
    id, name: `Plugin ${id}`, version, description: 'd', icon: 'extension', surfaces: ['Une page'],
    requires: [], guestflow: '>=3.0.0', sdk: '^1.0.0', changelog: { [version]: [`Version ${version}.`] }, ...extra,
  };
  fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(src, 'server'));
  fs.mkdirSync(path.join(src, 'client'));
  fs.writeFileSync(path.join(src, 'server', 'index.js'), `module.exports = { id: '${id}', register() {} };`);
  fs.writeFileSync(path.join(src, 'client', 'index.js'), `export default { id: '${id}', contributes: {} };`);
  const file = path.join(dir, `${id}-${version}.tgz`);
  execFileSync('tar', ['-czf', file, '-C', src, 'manifest.json', 'server', 'client'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  return { file, sha256: sha(fs.readFileSync(file)) };
}

function instance() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-push-'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir);
  const dbPath = path.join(dataDir, 'guestflow.db');
  execFileSync(process.execPath, [FIRST_ADMIN, '--email', 'claire@aulnes.fr', '--name', 'Claire'], {
    env: { PATH: process.env.PATH, DB_PATH: dbPath }, stdio: 'ignore',
  });
  const db = new Database(dbPath);
  db.prepare("INSERT INTO plugins (id, enabled, source, version) VALUES ('linen', 1, 'bundled', '1.0.1')").run();
  db.close();
  return { dir, dataDir, dbPath };
}

function runSwitch(dbPath, args) {
  return spawnSync(process.execPath, [SWITCH, ...args], {
    env: { PATH: process.env.PATH, DB_PATH: dbPath, GUESTFLOW_PLUGINS_DIST: path.join(path.dirname(dbPath), 'no-dist') }, encoding: 'utf8',
  });
}

const row = (dbPath) => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare("SELECT source, version, previous_version AS previousVersion, previous_source AS previousSource, rollback_until AS rollbackUntil FROM plugins WHERE id = 'linen'").get();
  } finally {
    db.close();
  }
};

test('rule 11 — the pushed package is checked, unpacked, made current, and the row keeps the previous one', () => {
  const inst = instance();
  try {
    const pkg = makePackage(inst.dir, 'linen', '1.0.2');
    const out = runSwitch(inst.dbPath, ['--id', 'linen', '--version', '1.0.2', '--file', pkg.file, '--sha256', pkg.sha256]);
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout.trim().split('\n').pop()), { switched: true, from: { version: '1.0.1', source: 'bundled' }, to: '1.0.2' });
    const r = row(inst.dbPath);
    assert.deepEqual([r.source, r.version, r.previousSource, r.previousVersion], ['registry', '1.0.2', 'bundled', '1.0.1']);
    assert.ok(r.rollbackUntil);
    const current = path.join(inst.dataDir, 'plugins', 'linen');
    assert.equal(fs.readlinkSync(path.join(current, 'current')), '1.0.2');
    assert.ok(fs.existsSync(path.join(current, '1.0.2', 'manifest.json')));

    // Rollback: the console put the snapshot's database back (the bundled row); `current` goes.
    const db = new Database(inst.dbPath);
    db.prepare("UPDATE plugins SET source = 'bundled', version = '1.0.1', previous_version = NULL, previous_source = NULL WHERE id = 'linen'").run();
    db.close();
    const synced = runSwitch(inst.dbPath, ['--sync', '--id', 'linen']);
    assert.equal(synced.status, 0, synced.stderr);
    assert.deepEqual(JSON.parse(synced.stdout.trim()), { synced: true, version: '1.0.1' });
    assert.equal(fs.existsSync(path.join(current, 'current')), false);
  } finally {
    fs.rmSync(inst.dir, { recursive: true, force: true });
  }
});

test('rule 11 — a package whose SHA-256 differs, or a plugin the instance does not have, is refused and nothing changes', () => {
  const inst = instance();
  try {
    const pkg = makePackage(inst.dir, 'linen', '1.0.2');
    const bad = runSwitch(inst.dbPath, ['--id', 'linen', '--version', '1.0.2', '--file', pkg.file, '--sha256', '0'.repeat(64)]);
    assert.equal(bad.status, 5);
    assert.match(bad.stderr, /Paquet refusé/);
    assert.deepEqual([row(inst.dbPath).source, row(inst.dbPath).version], ['bundled', '1.0.1']);
    const other = makePackage(inst.dir, 'sas', '1.0.0');
    const absent = runSwitch(inst.dbPath, ['--id', 'sas', '--version', '1.0.0', '--file', other.file, '--sha256', other.sha256]);
    assert.equal(absent.status, 4);
    const tooNew = makePackage(inst.dir, 'linen', '2.0.0', { guestflow: '>=99.0.0' });
    const refused = runSwitch(inst.dbPath, ['--id', 'linen', '--version', '2.0.0', '--file', tooNew.file, '--sha256', tooNew.sha256]);
    assert.equal(refused.status, 5);
    assert.equal(row(inst.dbPath).version, '1.0.1');
    assert.equal(runSwitch(inst.dbPath, ['--id', 'linen']).status, 2, 'usage');
  } finally {
    fs.rmSync(inst.dir, { recursive: true, force: true });
  }
});

test('rules 11, 30 — an older or equal version is refused like on the instance, unless the installed package cannot run here', () => {
  const inst = instance();
  try {
    for (const v of ['1.0.0', '1.0.1']) {
      const pkg = makePackage(inst.dir, 'linen', v);
      const out = runSwitch(inst.dbPath, ['--id', 'linen', '--version', v, '--file', pkg.file, '--sha256', pkg.sha256]);
      assert.equal(out.status, 5, v);
      assert.match(out.stderr, /version antérieure ou égale à 1\.0\.1, refusée/);
      assert.deepEqual([row(inst.dbPath).source, row(inst.dbPath).version], ['bundled', '1.0.1']);
    }
    // The installed 1.0.1 asks for a core this release is not: going back to 1.0.0 is allowed (rule 14).
    const db = new Database(inst.dbPath);
    db.prepare("UPDATE plugins SET manifest = ? WHERE id = 'linen'").run(JSON.stringify({ id: 'linen', version: '1.0.1', guestflow: '>=99.0.0', sdk: '^1.0.0', requires: [] }));
    db.close();
    const older = makePackage(inst.dir, 'linen', '1.0.0');
    const out = runSwitch(inst.dbPath, ['--id', 'linen', '--version', '1.0.0', '--file', older.file, '--sha256', older.sha256]);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(row(inst.dbPath).version, '1.0.0');
  } finally {
    fs.rmSync(inst.dir, { recursive: true, force: true });
  }
});

test('rule 11 — pluginHealth says which version loaded, and whether it failed', () => {
  const host = require('../plugins/host');
  host.setLoaded('linen', '1.0.2', 'abc');
  const ok = { get: () => ({ failed: null }) };
  const failed = { get: () => ({ failed: 'register threw' }) };
  assert.deepEqual(host.pluginHealth('linen', ok), { id: 'linen', version: '1.0.2', ok: true });
  assert.deepEqual(host.pluginHealth('linen', failed), { id: 'linen', version: '1.0.2', ok: false });
  host.unsetLoaded('linen');
  assert.deepEqual(host.pluginHealth('linen', ok), { id: 'linen', version: null, ok: false });
});

test('rules 11, 33 — /api/version answers the plugin only to the console: its secret header, or loopback without a secret', () => {
  const { buildVersionHandler } = require('../controllers/versionController');
  const call = (handler, { plugin = 'linen', headers = {}, remoteAddress = '203.0.113.9' } = {}) => {
    let body;
    handler({ query: { plugin }, headers, socket: { remoteAddress } }, { json: (b) => { body = b; } });
    return body;
  };
  const deps = { getVersion: () => '3.10.1', pluginHealth: (id) => ({ id, version: '1.0.0', ok: true }), startedAt: 't' };
  const hosted = buildVersionHandler({ ...deps, secret: 's3cret' });
  assert.equal(call(hosted).version, '3.10.1');
  assert.equal('plugin' in call(hosted), false, 'a visitor never learns what is installed');
  assert.equal('plugin' in call(hosted, { remoteAddress: '127.0.0.1' }), false, 'behind Caddy every request is loopback');
  assert.equal('plugin' in call(hosted, { headers: { 'x-guestflow-health': 'wrong' } }), false);
  assert.deepEqual(call(hosted, { headers: { 'x-guestflow-health': 's3cret' } }).plugin, { id: 'linen', version: '1.0.0', ok: true });
  const selfHosted = buildVersionHandler(deps);
  assert.equal('plugin' in call(selfHosted), false);
  assert.equal(call(selfHosted, { remoteAddress: '::1' }).plugin.version, '1.0.0');
  assert.equal('plugin' in call(hosted, { plugin: '../x', headers: { 'x-guestflow-health': 's3cret' } }), false);
});
