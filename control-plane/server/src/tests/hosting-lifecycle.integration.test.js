// specs/hosting-h1-fleet-runtime.md §7, integration — the whole lifecycle with the `local` drivers
// (H-D6) and real instances: `node <release>/server/src/index.js` started from its env file, its real
// database, its real first administrator.
//
//   rule 1   create a customer: the ten steps, then the instance answers on its port;
//   rule 3   stop: the closed page is routed and the port no longer answers;
//   rule 4   restart: it answers again;
//   rule 10  update to a second release; a release that fails its health check is rolled back;
//   rules 13, 14  a backup verified, then restored to a moment;
//   rule 6   erase: no process, no route, no copies, no directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../database');
const { createContext } = require('../context');
const { createSecrets } = require('../utils/secrets');
const { createFirstAdminRunner } = require('../utils/firstAdmin');
const { readEnv } = require('../utils/instanceEnv');
const { makeDevRelease } = require('../../scripts/dev-release');
const { makeMailer, NEW_CUSTOMER } = require('./helpers');

const RANGE = process.env.CP_TEST_PORT_RANGE || '4480-4499';

async function version(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`);
    return res.ok ? (await res.json()).version : null;
  } catch {
    return null;
  }
}

test('integration — create, answer, stop, restart, update and roll back, back up and restore, erase', { timeout: 170000 }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-h1-'));
  const instancesRoot = path.join(base, 'instances');
  const releasesDir = path.join(base, 'releases');
  const dataDir = path.join(base, 'console');
  fs.mkdirSync(instancesRoot, { recursive: true });
  makeDevRelease({ releasesDir, version: '9.0.0' });
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const mailer = makeMailer();
  const ctx = createContext({
    db: openDatabase(':memory:'),
    now: () => new Date(),
    mailer,
    secrets: createSecrets(crypto.randomBytes(32)),
    privateKey,
    instancesRoot,
    dataDir,
    domain: 'guestflow.test',
    consoleUrl: 'https://console.guestflow.test',
    directoryKey: crypto.randomBytes(32),
    runFirstAdmin: createFirstAdminRunner(),
    releasesDir,
    hostingEnv: { CP_PORT_RANGE: RANGE, CP_HEALTH_TIMEOUT_MS: '45000', CP_LOCAL_BACKUP_DIR: path.join(base, 'backups') },
  });
  const { customers, fleet } = ctx.controllers;
  let inst = null;
  try {
    // Rule 1.
    let v = await customers.create(NEW_CUSTOMER, 'op');
    assert.deepEqual(v.steps.filter((s) => s.status !== 'ok').map((s) => [s.step, s.detail]), []);
    inst = ctx.provisioner.instanceOf(customers.mustGet(v.id));
    assert.equal(await version(inst.port), '9.0.0');
    assert.equal(readEnv(inst.dir).GUESTFLOW_MANAGED, '1');
    const invite = mailer.sent.find((m) => m.to === 'claire@aulnes.fr');
    assert.match(invite.text, /Mot de passe provisoire : \S+/);
    const users = new Database(inst.dbPath, { readonly: true });
    const emails = users.prepare('SELECT email FROM users').all().map((u) => u.email);
    assert.ok(emails.includes('claire@aulnes.fr'));
    assert.ok(!emails.includes('admin@guestflow.local'), 'the bootstrap account is gone');
    users.close();

    // Rules 3, 4.
    v = await customers.deprovision(v.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(v.deprovisionSteps.at(-1).status, 'ok');
    assert.deepEqual(ctx.drivers.proxy.route('aulnes'), { kind: 'closed' });
    assert.equal(await version(inst.port), null);
    v = await customers.reactivate(v.id, 'op');
    assert.equal(v.steps.find((s) => s.step === 'restart').status, 'ok');
    assert.equal(await version(inst.port), '9.0.0');
    assert.deepEqual(ctx.drivers.proxy.route('aulnes'), { kind: 'site', port: inst.port });

    // Rule 10: a good release, then a broken one rolled back.
    makeDevRelease({ releasesDir, version: '9.1.0' });
    makeDevRelease({ releasesDir, version: '9.2.0', broken: true });
    fleet.startUpdate({ targetVersion: '9.1.0' }, 'op');
    await ctx.fleetUpdater.whenIdle();
    assert.equal(fleet.view().history[0].state, 'done', JSON.stringify(fleet.view().history[0]));
    assert.equal(await version(inst.port), '9.1.0');
    fleet.startUpdate({ targetVersion: '9.2.0', customerIds: [v.id] }, 'op');
    await ctx.fleetUpdater.whenIdle();
    const failed = fleet.view().history[0];
    assert.equal(failed.state, 'failed');
    assert.equal(failed.items[0].state, 'rolled_back');
    assert.match(failed.items[0].detail, /retour en 9\.1\.0, base de l’instantané remise\.$/);
    assert.equal(await version(inst.port), '9.1.0');
    assert.equal(readEnv(inst.dir).GUESTFLOW_VERSION, '9.1.0');

    // Rules 13, 14: a copy, a change, a restore to the moment of the copy.
    const write = (sql) => { const db = new Database(inst.dbPath); try { db.exec(sql); } finally { db.close(); } };
    write('CREATE TABLE IF NOT EXISTS h1_probe (x INTEGER); INSERT INTO h1_probe VALUES (1);');
    const copiedAt = await ctx.drivers.backup.snapshotNow(inst);
    await new Promise((r) => setTimeout(r, 20));
    write('INSERT INTO h1_probe VALUES (2);');
    const [check] = await ctx.restoreVerifier.weekly();
    assert.equal(check.ok, true);
    await fleet.restore(v.id, { at: copiedAt }, 'op');
    const restored = new Database(inst.dbPath, { readonly: true });
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM h1_probe').get().n, 1);
    restored.close();
    assert.equal(await version(inst.port), '9.1.0');
    assert.ok(fs.readdirSync(path.dirname(inst.dbPath)).some((f) => f.startsWith('guestflow.db.before-restore-')));

    // Rule 6.
    await customers.deprovision(v.id, { confirmSlug: 'aulnes' }, 'op');
    await customers.eraseNow(v.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(fs.existsSync(inst.dir), false);
    assert.equal(ctx.drivers.proxy.route('aulnes'), null);
    assert.equal(await ctx.drivers.backup.lastReplicatedAt(inst), null);
    assert.equal(await version(inst.port), null);
  } finally {
    if (inst && fs.existsSync(inst.dir)) await ctx.drivers.process.stop(inst).catch(() => {});
    fs.rmSync(base, { recursive: true, force: true });
  }
});
