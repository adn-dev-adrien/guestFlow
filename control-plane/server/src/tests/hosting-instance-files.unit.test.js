// specs/hosting-h1-fleet-runtime.md rule 21 — the console never follows what an instance planted in
// its own directory (a symlinked database, a symlinked data/, a link at the licence's temporary
// name), leaves every database it creates or replaces writable by the instance's group, ships
// releases group-readable and never group-writable, and keeps the env files out of the instance's
// reach (moving an older one out of its directory).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { assertInside, shareDatabase } = require('../utils/instanceFiles');
const { shareRelease } = require('../utils/releases');
const { readEnv, writeEnv } = require('../utils/instanceEnv');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-files-')));
const mode = (f) => fs.statSync(f).mode & 0o7777;

test('rule 21 — a database replaced by a link is never read, copied or exported', async () => {
  const h = makeContext({ at: '2026-10-08T10:00:00Z' });
  try {
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    require('./helpers').makeRelease(h.releasesDir, '3.10.0');
    const secret = path.join(h.dataDir, 'secret.db');
    const s = new Database(secret);
    s.exec("CREATE TABLE plugins (id TEXT, enabled INTEGER); INSERT INTO plugins VALUES ('console-secret', 1)");
    s.close();
    const dbPath = path.join(h.root, 'aulnes', 'data', 'guestflow.db');
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${ext}`, { force: true });
    fs.symlinkSync(secret, dbPath);
    assert.equal(h.ctx.instances.readFacts('aulnes'), null, 'not read through the link');
    assert.throws(() => assertInside(path.join(h.root, 'aulnes'), dbPath), /lien symbolique/);
    h.ctx.controllers.fleet.startUpdate({ targetVersion: '3.10.0' }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    const [u] = h.ctx.controllers.fleet.view().history;
    assert.match(u.items[0].detail, /^Instantané impossible : Fichier refusé \(guestflow\.db\) : lien symbolique/);
    const backups = path.join(h.root, 'aulnes', 'data', 'backups');
    assert.ok(!fs.existsSync(backups) || fs.readdirSync(backups).length === 0, 'no copy of the console’s file');
    const v = await h.ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(v.deprovisionSteps[0].status, 'failed', 'no export of it either');
  } finally {
    h.cleanup();
  }
});

test('rule 21 — a data/ leading out of the instance, or a link at the licence’s temporary name, is refused', async () => {
  const h = makeContext();
  try {
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const data = path.join(h.root, 'aulnes', 'data');
    const victim = path.join(h.dataDir, 'victim.txt');
    fs.writeFileSync(victim, 'console');
    fs.symlinkSync(victim, path.join(data, `licence.jws.${process.pid}.tmp`));
    h.ctx.controllers.customers.refresh(c.id, 'système');
    assert.equal(fs.readFileSync(victim, 'utf8'), 'console', 'the link is removed, never written through');
    const outside = tmp();
    fs.renameSync(data, `${data}.real`);
    fs.symlinkSync(outside, data);
    h.ctx.controllers.customers.refresh(c.id, 'système');
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing written outside');
    assert.equal(h.ctx.controllers.customers.view(c.id).steps.find((s) => s.step === 'licence').status, 'failed');
  } finally {
    h.cleanup();
  }
});

test('rule 21 — every database the console creates or replaces is 0660, its WAL files follow', async () => {
  const dir = tmp();
  const db = path.join(dir, 'guestflow.db');
  const d = new Database(db);
  d.pragma('journal_mode = WAL');
  d.exec('CREATE TABLE t (x)');
  shareDatabase(db);
  assert.equal(mode(db), 0o660);
  assert.equal(mode(`${db}-wal`), 0o660);
  d.close();
  const h = makeContext();
  try {
    await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    assert.equal(mode(path.join(h.root, 'aulnes', 'data', 'guestflow.db')), 0o660, 'after the database step');
    const v = await h.ctx.controllers.fleet.restore(1, { at: '2026-09-29T10:00:00Z' }, 'op');
    assert.ok(v.notice);
    assert.equal(mode(path.join(h.root, 'aulnes', 'data', 'guestflow.db')), 0o660, 'after a restore');
  } finally {
    h.cleanup();
  }
});

test('rule 21 — a release is group-readable, never group-writable, invisible to others; links untouched', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'server', 'src'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'server', 'src', 'index.js'), '', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'run.sh'), '', { mode: 0o766 });
  fs.symlinkSync('/etc/hosts', path.join(dir, 'link'));
  shareRelease(dir);
  assert.equal(mode(path.join(dir, 'server')), 0o750);
  assert.equal(mode(path.join(dir, 'server', 'src', 'index.js')), 0o640);
  assert.equal(mode(path.join(dir, 'run.sh')), 0o750);
  assert.equal(fs.lstatSync(path.join(dir, 'link')).isSymbolicLink(), true);
});

test('rule 21 — env files live outside the instance directory; an older one is moved out once', async () => {
  const h = makeContext();
  try {
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const envFile = h.ctx.instances.envFileOf('aulnes');
    const vars = readEnv(envFile);
    fs.rmSync(envFile);
    writeEnv(path.join(h.root, 'aulnes', 'env'), vars);
    h.ctx.provisioner.syncEnv(h.ctx.controllers.customers.mustGet(c.id));
    assert.equal(fs.existsSync(path.join(h.root, 'aulnes', 'env')), false);
    assert.equal(readEnv(envFile).GUESTFLOW_ENCRYPTION_KEY, vars.GUESTFLOW_ENCRYPTION_KEY, 'the secrets survive the move');
    assert.ok(readEnv(envFile).GUESTFLOW_PROXY_SECRET.length >= 30, 'the proxy secret is written once and kept');
  } finally {
    h.cleanup();
  }
});
