// specs/hosting-h1-fleet-runtime.md rules 10–11 — the operator updates one customer, a selection or
// the whole fleet, one instance at a time: a snapshot, the version switched, a restart, a health
// check on that version. A failed check puts that instance back on its previous version and its
// snapshot's database, and the fleet update stops there. Plugins are pushed the same way to the
// instances that have them. A restore waits for a running update (edge case of §3).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { readEnv } = require('../utils/instanceEnv');

async function fleetOfThree(opts = {}) {
  const h = makeContext({ versions: ['3.9.0'], ...opts });
  const { customers } = h.ctx.controllers;
  const a = await customers.create(NEW_CUSTOMER, 'op');
  const b = await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
  const c = await customers.create({ ...NEW_CUSTOMER, slug: 'ombre', companyName: 'Domaine Ombre', contactEmail: 'li@ombre.fr' }, 'op');
  require('./helpers').makeRelease(h.releasesDir, '3.10.0');
  return { ...h, a, b, c };
}

const reservations = (root, slug) => {
  const db = new Database(path.join(root, slug, 'data', 'guestflow.db'));
  try { return db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n; } finally { db.close(); }
};

test('rule 10 — the whole fleet, one instance at a time: snapshot, switch, restart, health on the new version', async () => {
  const h = await fleetOfThree();
  try {
    const order = [];
    const start = h.host.drivers.process.start;
    h.host.drivers.process.start = async (inst) => { order.push(inst.slug); await start(inst); };
    const view = h.ctx.controllers.fleet.startUpdate({ targetVersion: '3.10.0' }, 'op');
    assert.equal(view.running.items.length, 3);
    await h.ctx.fleetUpdater.whenIdle();
    const [done] = h.ctx.controllers.fleet.view().history;
    assert.equal(done.state, 'done');
    assert.equal(done.scopeLabel, 'toute la flotte');
    assert.deepEqual(done.items.map((i) => [i.state, i.detail]), [['done', '3.10.0 répond.'], ['done', '3.10.0 répond.'], ['done', '3.10.0 répond.']]);
    assert.deepEqual(order, ['ombre', 'aulnes', 'moulin'], 'one after the other, each once');
    for (const slug of ['aulnes', 'moulin', 'ombre']) {
      assert.equal(readEnv(h.ctx.instances.envFileOf(slug)).GUESTFLOW_VERSION, '3.10.0');
      assert.equal(fs.readdirSync(path.join(h.root, slug, 'data', 'backups')).filter((f) => f.startsWith('before-update-')).length, 1, 'one snapshot each');
    }
    assert.equal(h.ctx.models.hosting.get(h.a.id).previous_version, '3.9.0');
    assert.ok(h.ctx.controllers.customers.view(h.a.id).history.some((x) => x.text === 'Mise à jour 3.9.0 → 3.10.0'));
  } finally {
    h.cleanup();
  }
});

test('rule 10 — a failed health check rolls that instance back, restores its snapshot, and stops the fleet update there', async () => {
  const h = await fleetOfThree({ hostingEnv: { CP_HEALTH_TIMEOUT_MS: '150' } });
  try {
    // In fleet order (Domaine Ombre, Gîte des Aulnes, Le Moulin) the new version answers on the first
    // instance, then never on the second, which also wrote to its database after the switch.
    const db = new Database(path.join(h.root, 'aulnes', 'data', 'guestflow.db'));
    const before = reservations(h.root, 'aulnes');
    let seen = 0;
    const start = h.host.drivers.process.start;
    h.host.drivers.process.start = async (inst) => {
      await start(inst);
      seen += 1;
      if (inst.slug === 'aulnes' && seen === 2) {
        h.host.unhealthy.add('3.10.0');
        db.exec("INSERT INTO reservations (guest, total) VALUES ('écrit par la 3.10.0', 1)");
      }
    };
    h.ctx.controllers.fleet.startUpdate({ targetVersion: '3.10.0', customerIds: [h.a.id, h.b.id, h.c.id] }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    db.close();
    const [u] = h.ctx.controllers.fleet.view().history;
    assert.equal(u.state, 'failed');
    assert.equal(u.scopeLabel, 'une sélection');
    assert.match(u.error, /^Gîte des Aulnes : aucune réponse de \/api\/version en 0 s/);
    assert.deepEqual(u.items.map((i) => i.state), ['done', 'rolled_back', 'skipped']);
    assert.match(u.items[1].detail, /retour en 3\.9\.0, base de l’instantané remise\.$/);
    assert.equal(u.items[2].detail, 'Mise à jour arrêtée.');
    assert.equal(readEnv(h.ctx.instances.envFileOf('ombre')).GUESTFLOW_VERSION, '3.10.0');
    assert.equal(readEnv(h.ctx.instances.envFileOf('aulnes')).GUESTFLOW_VERSION, '3.9.0', 'back on its previous version');
    assert.equal(readEnv(h.ctx.instances.envFileOf('moulin')).GUESTFLOW_VERSION, '3.9.0', 'untouched');
    assert.equal(reservations(h.root, 'aulnes'), before, 'the snapshot’s database is back');
    assert.equal(seen, 3, 'ombre started, aulnes started on the new version, then on the old one');
    assert.equal(h.host.procs.get('aulnes').running, true);
  } finally {
    h.cleanup();
  }
});

test('rule 10 — one customer at a time from its page; a second update while one runs is refused', async () => {
  const h = await fleetOfThree();
  try {
    const { fleet } = h.ctx.controllers;
    fleet.startUpdate({ targetVersion: '3.10.0', customerIds: [h.b.id] }, 'op');
    assert.throws(() => fleet.startUpdate({ targetVersion: '3.10.0' }, 'op'), (e) => e.status === 409 && e.body.error === 'UPDATE_RUNNING');
    await h.ctx.fleetUpdater.whenIdle();
    assert.equal(fleet.view().history[0].scopeLabel, 'un client');
    assert.deepEqual(fleet.view().instances.map((i) => [i.companyName, i.version]), [['Domaine Ombre', '3.9.0'], ['Gîte des Aulnes', '3.9.0'], ['Le Moulin', '3.10.0']]);
    assert.throws(() => fleet.startUpdate({ targetVersion: '4.0.0' }, 'op'), (e) => e.body.error === 'NOT_INSTALLED');
    assert.throws(() => fleet.startUpdate({ targetVersion: '3.10.0', customerIds: [h.b.id] }, 'op'), (e) => e.body.error === 'NOTHING_TO_DO');
  } finally {
    h.cleanup();
  }
});

test('edge case — restoring while a fleet update runs is refused (409) until it ends', async () => {
  const h = await fleetOfThree();
  try {
    h.ctx.controllers.fleet.startUpdate({ targetVersion: '3.10.0' }, 'op');
    await assert.rejects(h.ctx.controllers.fleet.restore(h.a.id, { at: '2026-09-29T09:00:00Z' }, 'op'), (e) => e.status === 409 && e.body.error === 'UPDATE_RUNNING');
    await h.ctx.fleetUpdater.whenIdle();
  } finally {
    h.cleanup();
  }
});

test('rule 11 — a plugin update is pushed the same way, only to the instances that have the plugin installed', async () => {
  const pushed = [];
  const installer = {
    async install(inst, id, version) { pushed.push([inst.slug, id, version]); },
    async rollback() {},
  };
  const h = makeContext({ pluginInstaller: installer });
  try {
    const { customers, fleet } = h.ctx.controllers;
    makeInstance(h.root, 'aulnes', { installed: ['sas', 'neat'] });
    makeInstance(h.root, 'moulin', { installed: ['sas'] });
    await customers.create(NEW_CUSTOMER, 'op');
    await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
    assert.deepEqual(fleet.view().pluginPush, { available: true, plugins: [{ id: 'neat', count: 1 }, { id: 'sas', count: 2 }] });
    fleet.pushPlugin({ pluginId: 'neat', version: '1.2.0' }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    assert.deepEqual(pushed, [['aulnes', 'neat', '1.2.0']]);
    const [u] = fleet.view().history;
    assert.equal(u.title, 'neat 1.2.0');
    assert.deepEqual(u.items.map((i) => i.state), ['done']);
  } finally {
    h.cleanup();
  }
});

test('rule 11 — without the plugin registry the push is not offered', () => {
  const h = makeContext();
  try {
    assert.equal(h.ctx.controllers.fleet.view().pluginPush.available, false);
    assert.throws(() => h.ctx.controllers.fleet.pushPlugin({ pluginId: 'neat', version: '1.2.0' }, 'op'), (e) => e.status === 412);
  } finally {
    h.cleanup();
  }
});
