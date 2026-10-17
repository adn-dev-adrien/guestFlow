// specs/hosting-h1-fleet-runtime.md rules 1–7 — the console provisions, stops, restarts, renames and
// erases an instance through the drivers: the ten steps in order, each idempotent, a failure that
// stops the sequence and « Reprendre » that resumes it without duplicating anything, the ports, and
// no step left to tick by hand.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { readEnv } = require('../utils/instanceEnv');

const ORDER = ['dir', 'secrets', 'port', 'licence', 'database', 'admin', 'process', 'route', 'health', 'backup'];

test('rule 1 — creating a customer runs the steps in order: directory, secrets, port, database, unit, site, health, replica', async () => {
  const h = makeContext({ versions: ['3.8.0', '3.9.0'] });
  try {
    const v = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    assert.deepEqual(v.steps.map((s) => s.step), ORDER);
    assert.ok(v.steps.every((s) => s.status === 'ok'), JSON.stringify(v.steps));
    const dir = path.join(h.root, 'aulnes');
    for (const sub of ['data', 'uploads']) assert.ok(fs.statSync(path.join(dir, sub)).isDirectory());
    assert.equal(fs.statSync(path.join(dir, 'env')).mode & 0o777, 0o600);
    const env = readEnv(dir);
    assert.equal(env.PORT, '4400');
    assert.equal(env.GUESTFLOW_VERSION, '3.9.0', 'the newest installed release');
    assert.equal(env.GUESTFLOW_RELEASE_DIR, path.join(h.releasesDir, '3.9.0'));
    assert.equal(env.GUESTFLOW_SLUG, 'aulnes');
    assert.ok(env.GUESTFLOW_ENCRYPTION_KEY.length >= 40 && env.GUESTFLOW_SESSION_SECRET.length >= 40);
    assert.ok(env.GUESTFLOW_LICENCE_PUBLIC_KEY);
    assert.ok(fs.existsSync(path.join(dir, 'data', 'licence.jws')));
    assert.deepEqual(h.host.calls.map((c) => c.name), ['process.initDatabase', 'process.enableNow', 'proxy.writeSite', 'backup.addReplica']);
    assert.deepEqual(h.host.routes.aulnes, { kind: 'site', port: 4400 });
    assert.equal(v.hosting.version, '3.9.0');
    assert.equal(v.hosting.port, 4400);
    assert.match(v.steps.find((s) => s.step === 'health').detail, /^3\.9\.0 répond\.$/);
  } finally {
    h.cleanup();
  }
});

test('rule 2 — a failed step stops the sequence with its error; « Reprendre » resumes from it and duplicates nothing', async () => {
  const h = makeContext();
  try {
    h.host.failNext['proxy.writeSite'] = new Error('Caddy : unrecognized directive (configuration précédente conservée)');
    let v = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    const route = v.steps.find((s) => s.step === 'route');
    assert.equal(route.status, 'failed');
    assert.equal(route.detail, 'Caddy : unrecognized directive (configuration précédente conservée)');
    assert.equal(route.action, 'resume');
    assert.deepEqual(v.steps.filter((s) => s.status === 'todo').map((s) => s.step), ['health', 'backup']);
    const secret = readEnv(path.join(h.root, 'aulnes')).GUESTFLOW_ENCRYPTION_KEY;
    v = await h.ctx.controllers.customers.stepAction(v.id, 'route', 'resume', 'op');
    assert.ok(v.steps.every((s) => s.status === 'ok'));
    assert.equal(readEnv(path.join(h.root, 'aulnes')).GUESTFLOW_ENCRYPTION_KEY, secret, 'the secrets are never regenerated');
    assert.equal(h.host.named('process.initDatabase').length, 1, 'the database is initialised once');
    assert.equal(h.host.named('process.enableNow').length, 1);
    assert.equal(h.mailer.sent.filter((m) => /est prêt$/.test(m.subject)).length, 1, 'one invitation');
    assert.ok(v.history.some((x) => /Étape « Route et certificat TLS » en échec/.test(x.text)));
    assert.ok(v.history.some((x) => /Création reprise à l’étape « Route et certificat TLS »/.test(x.text)));
  } finally {
    h.cleanup();
  }
});

test('rule 2 — two sequences for one customer never run at the same time', async () => {
  const h = makeContext();
  try {
    const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op', { background: true });
    assert.equal(c.provisioningRunning, true);
    const second = h.ctx.provisioner.create(c.id);
    await Promise.all([h.ctx.provisioner.whenIdle(c.id), second]);
    assert.equal(h.host.named('process.enableNow').length, 1);
    assert.equal(h.ctx.controllers.customers.view(c.id).provisioningRunning, false);
  } finally {
    h.cleanup();
  }
});

test('rule 1 — ports come from CP_PORT_RANGE, one per customer; an exhausted range stops at the port step, naming it', async () => {
  const h = makeContext({ hostingEnv: { CP_PORT_RANGE: '4470-4471' } });
  try {
    const { customers } = h.ctx.controllers;
    const a = await customers.create(NEW_CUSTOMER, 'op');
    const b = await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', contactEmail: 'jo@moulin.fr' }, 'op');
    const c = await customers.create({ ...NEW_CUSTOMER, slug: 'pinede', contactEmail: 'li@pinede.fr' }, 'op');
    assert.deepEqual([a.hosting.port, b.hosting.port], [4470, 4471]);
    const step = c.steps.find((s) => s.step === 'port');
    assert.equal(step.status, 'failed');
    assert.equal(step.detail, 'Plage de ports 4470-4471 épuisée.');
  } finally {
    h.cleanup();
  }
});

test('rule 1 — without any release on the host the database step says what to do', async () => {
  const h = makeContext({ versions: [] });
  try {
    const v = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
    assert.equal(v.steps.find((s) => s.step === 'database').detail, 'Aucune version installée sur l’hôte : en installer une depuis « Versions ».');
  } finally {
    h.cleanup();
  }
});

test('rules 3, 4 — deprovisioning stops the unit, serves the closed page and keeps the copies; reactivating brings it all back', async () => {
  const h = makeContext();
  try {
    const { customers } = h.ctx.controllers;
    const c = await customers.create(NEW_CUSTOMER, 'op');
    let v = await customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(v.deprovisionSteps.find((s) => s.step === 'deprov-stop').status, 'ok');
    assert.equal(h.host.procs.get('aulnes').running, false);
    assert.deepEqual(h.host.routes.aulnes, { kind: 'closed' });
    assert.equal(h.host.replicas.get(`c${c.id}`).active, false, 'replication stops, the copies stay until the erasure');
    v = await customers.reactivate(c.id, 'op');
    assert.equal(v.steps.find((s) => s.step === 'restart').status, 'ok');
    assert.equal(h.host.procs.get('aulnes').running, true);
    assert.deepEqual(h.host.routes.aulnes, { kind: 'site', port: 4400 });
    assert.equal(h.host.replicas.get(`c${c.id}`).active, true);
  } finally {
    h.cleanup();
  }
});

test('rule 5 — renaming moves the directory, runs the unit under the new slug, adds the site, and the old address answers 301 for 90 days', async () => {
  const h = makeContext({ at: '2026-10-08T08:00:00Z' });
  try {
    const { customers } = h.ctx.controllers;
    const c = await customers.create(NEW_CUSTOMER, 'op');
    const all = customers.RENAME_CHECKLIST.map((i) => i.key);
    const v = await customers.rename(c.id, { slug: 'les-aulnes', checked: all }, 'op');
    assert.equal(v.steps.find((s) => s.step === 'rename').status, 'ok');
    assert.equal(fs.existsSync(path.join(h.root, 'aulnes')), false);
    assert.equal(readEnv(path.join(h.root, 'les-aulnes')).GUESTFLOW_SLUG, 'les-aulnes');
    assert.equal(readEnv(path.join(h.root, 'les-aulnes')).DB_PATH, path.join(h.root, 'les-aulnes', 'data', 'guestflow.db'));
    assert.equal(h.host.procs.get('les-aulnes').running, true);
    assert.equal(h.host.procs.has('aulnes'), false, 'the old unit is gone');
    assert.deepEqual(h.host.routes['les-aulnes'], { kind: 'site', port: 4400 });
    assert.deepEqual(h.host.routes.aulnes, { kind: 'redirect', to: 'les-aulnes' });
    h.now.set('2027-01-06T10:00:00Z');
    assert.equal(await h.ctx.provisioner.dropExpiredRedirects(), 0, 'day 90: still redirecting');
    h.now.set('2027-01-07T10:00:00Z');
    assert.equal(await h.ctx.provisioner.dropExpiredRedirects(), 1);
    assert.equal(h.host.routes.aulnes, undefined);
  } finally {
    h.cleanup();
  }
});

test('rule 6 — erasure also removes the unit, the site, the redirects, the replica and the environment file', async () => {
  const h = makeContext();
  try {
    const { customers } = h.ctx.controllers;
    const c = await customers.create(NEW_CUSTOMER, 'op');
    await customers.rename(c.id, { slug: 'les-aulnes', checked: customers.RENAME_CHECKLIST.map((i) => i.key) }, 'op');
    await customers.deprovision(c.id, { confirmSlug: 'les-aulnes' }, 'op');
    await customers.eraseNow(c.id, { confirmSlug: 'les-aulnes' }, 'op');
    assert.equal(h.host.procs.has('les-aulnes'), false);
    assert.deepEqual(h.host.routes, {});
    assert.equal(h.host.replicas.has(`c${c.id}`), false);
    assert.equal(fs.existsSync(path.join(h.root, 'les-aulnes')), false);
    assert.equal(h.ctx.models.hosting.get(c.id), null);
  } finally {
    h.cleanup();
  }
});

test('rule 7 — no step of creation, deprovisioning, reactivation or renaming is manual any more', () => {
  const h = makeContext();
  try {
    const c = h.ctx.controllers.customers;
    for (const s of [...c.CREATE_STEPS, ...c.DEPROVISION_STEPS, ...c.REACTIVATE_STEPS, ...c.RENAME_STEPS]) assert.equal(s.kind, 'auto', s.step);
    const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'customersController.js'), 'utf8');
    assert.doesNotMatch(source, /À faire à la main/);
  } finally {
    h.cleanup();
  }
});
