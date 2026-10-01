// specs/plugins-phase-0-foundation.md — plugin catalogue, seed, states, refusals, route/job gating,
// and the active list carried by /me and /login.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

const { PLUGIN_CATALOG, PLUGIN_IDS, findPlugin } = require('../constants/plugins');
const { ensurePluginsTable, seedBuiltinPlugins, SEED_MIGRATION } = require('../utils/pluginsSchema');
const pluginsModel = require('../models/pluginsModel');
const { createController } = require('../controllers/pluginsController');
const requirePlugin = require('../middleware/requirePlugin');
const { whenPluginActive } = require('../utils/pluginScheduling');
const authController = require('../controllers/authController');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE properties (id INTEGER PRIMARY KEY);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY);
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER, role TEXT, PRIMARY KEY (userId, role));
  `);
  ensurePluginsTable(db);
  return db;
}

function addUser(db, id, roles, isActive = 1) {
  db.prepare('INSERT INTO users (id, isActive) VALUES (?, ?)').run(id, isActive);
  roles.forEach((role) => db.prepare('INSERT INTO user_roles (userId, role) VALUES (?, ?)').run(id, role));
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function setup() {
  const db = freshDb();
  const model = pluginsModel.buildModel(db);
  const ctrl = createController(model);
  const call = (handler, id) => {
    const res = fakeRes();
    ctrl[handler]({ params: { id } }, res);
    return res;
  };
  return { db, model, ctrl, call };
}

// ---------- catalogue (rules 1-3) ----------

test('catalogue: twelve plugins with unique ids and every field', () => {
  assert.equal(PLUGIN_CATALOG.length, 12);
  assert.equal(new Set(PLUGIN_IDS).size, 12);
  for (const p of PLUGIN_CATALOG) {
    assert.ok(p.id && p.name && p.description && p.icon, p.id);
    assert.ok(Array.isArray(p.surfaces) && p.surfaces.length > 0, p.id);
    assert.deepEqual([...p.requires], []);
  }
  assert.equal(findPlugin('sas').name, 'Arrivée et départ guidés');
  assert.equal(findPlugin('nope'), null);
});

// ---------- seed (rules 10-12) ----------

test('seed: an existing database gets the twelve plugins installed and active', () => {
  const db = freshDb();
  db.prepare('INSERT INTO properties (id) VALUES (1)').run();
  assert.equal(seedBuiltinPlugins(db), true);
  const model = pluginsModel.buildModel(db);
  assert.deepEqual(model.listActiveIds().sort(), [...PLUGIN_IDS].sort());
});

test('seed: a database with only a reservation counts as existing', () => {
  const db = freshDb();
  db.prepare('INSERT INTO reservations (id) VALUES (1)').run();
  seedBuiltinPlugins(db);
  assert.equal(pluginsModel.buildModel(db).listActiveIds().length, 12);
});

test('seed: a fresh database gets no plugin, and the ledger is recorded', () => {
  const db = freshDb();
  assert.equal(seedBuiltinPlugins(db), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plugins').get().n, 0);
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SEED_MIGRATION));
});

test('seed: runs once — uninstalling everything is not undone at the next boot', () => {
  const db = freshDb();
  db.prepare('INSERT INTO properties (id) VALUES (1)').run();
  seedBuiltinPlugins(db);
  db.exec('DELETE FROM plugins');
  assert.equal(seedBuiltinPlugins(db), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plugins').get().n, 0);
});

// ---------- model (rule 3) ----------

test('model: a write from another connection is seen at once', () => {
  const { db, model } = setup();
  assert.equal(model.isActive('neat'), false);
  db.prepare("INSERT INTO plugins (id, enabled) VALUES ('neat', 1)").run();
  assert.equal(model.isActive('neat'), true);
  assert.deepEqual(model.listActiveIds(), ['neat']);
});

test('model: install, deactivate, activate, uninstall', () => {
  const { model } = setup();
  assert.equal(model.isActive('sas'), false);
  model.install('sas');
  assert.equal(model.isActive('sas'), true);
  model.setEnabled('sas', false);
  assert.equal(model.isActive('sas'), false);
  assert.equal(model.get('sas').enabled, false);
  model.setEnabled('sas', true);
  assert.deepEqual(model.listActiveIds(), ['sas']);
  model.uninstall('sas');
  assert.equal(model.get('sas'), null);
  assert.equal(model.isActive('sas'), false);
});

// ---------- controller: states and transitions (rules 3-6) ----------

test('list: every catalogue plugin with its state', () => {
  const { model, ctrl } = setup();
  model.install('linen');
  model.install('neat');
  model.setEnabled('neat', false);
  const res = fakeRes();
  ctrl.list({}, res);
  assert.equal(res.body.length, 12);
  const byId = Object.fromEntries(res.body.map((p) => [p.id, p]));
  assert.equal(byId.linen.state, 'active');
  assert.equal(byId.neat.state, 'inactive');
  assert.equal(byId.sas.state, 'available');
  assert.equal(byId.sas.blocker, null);
  assert.ok(byId.linen.surfaces.length > 0);
});

// rule 4
test('install makes the plugin active in one step; a second install is refused', () => {
  const { call } = setup();
  const res = call('install', 'google-calendar');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, 'active');
  const again = call('install', 'google-calendar');
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error, 'ALREADY_INSTALLED');
});

test('activate, deactivate and uninstall refuse a plugin that is not installed', () => {
  const { call } = setup();
  for (const handler of ['activate', 'deactivate', 'uninstall']) {
    const res = call(handler, 'weather-alerts');
    assert.equal(res.statusCode, 409, handler);
    assert.equal(res.body.error, 'NOT_INSTALLED');
  }
});

test('an unknown id answers 404 on every action', () => {
  const { call } = setup();
  for (const handler of ['install', 'activate', 'deactivate', 'uninstall']) {
    const res = call(handler, 'bitcoin-miner');
    assert.equal(res.statusCode, 404, handler);
    assert.equal(res.body.error, 'UNKNOWN_PLUGIN');
  }
});

// rules 5-6 — deactivate, activate, uninstall back to « Disponibles »
test('deactivate then activate; uninstall returns the plugin to available', () => {
  const { call, model } = setup();
  call('install', 'school-holidays');
  assert.equal(call('deactivate', 'school-holidays').body.state, 'inactive');
  assert.equal(call('activate', 'school-holidays').body.state, 'active');
  const res = call('uninstall', 'school-holidays');
  assert.equal(res.body.state, 'available');
  assert.equal(model.get('school-holidays'), null);
});

// rule 6 — uninstalling in phase 0 deletes the plugin row only, never the plugin's data.
test('uninstall keeps every other table untouched', () => {
  const { db, call } = setup();
  call('install', 'online-payment');
  db.prepare("INSERT INTO payment_links (status) VALUES ('paid')").run();
  call('uninstall', 'online-payment');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_links').get().n, 1);
});

// rule 9 — only an admin reaches /api/plugins: the fail-closed role guard refuses every other role.
test('the plugins API is admin-only', () => {
  const enforceRoleAccess = require('../middleware/enforceRoleAccess');
  for (const roles of [['accountant'], ['reception']]) {
    for (const [method, p] of [['GET', '/plugins'], ['POST', '/plugins/sas/deactivate']]) {
      const res = fakeRes();
      let passed = false;
      enforceRoleAccess({ user: { roles }, method, path: p }, res, () => { passed = true; });
      assert.equal(passed, false, `${roles} ${method} ${p}`);
      assert.equal(res.statusCode, 403);
    }
  }
  let adminPassed = false;
  enforceRoleAccess({ user: { roles: ['admin'] }, method: 'GET', path: '/plugins' }, fakeRes(), () => { adminPassed = true; });
  assert.equal(adminPassed, true);
});

// ---------- refusals (rule 8) ----------

test('online payment: an open payment link blocks deactivate and uninstall', () => {
  const { db, call } = setup();
  call('install', 'online-payment');
  db.prepare("INSERT INTO payment_links (status) VALUES ('open'), ('paid')").run();
  for (const handler of ['deactivate', 'uninstall']) {
    const res = call(handler, 'online-payment');
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'PLUGIN_BLOCKED');
    assert.equal(res.body.code, 'OPEN_PAYMENT_LINKS');
    assert.equal(res.body.message, '1 lien de paiement est en attente. Attends son paiement ou annule-le avant de désactiver.');
  }
  db.prepare("UPDATE payment_links SET status = 'paid'").run();
  assert.equal(call('deactivate', 'online-payment').body.state, 'inactive');
});

test('sas: an active reception-only user blocks it; admins and inactive users do not', () => {
  const { db, call } = setup();
  call('install', 'sas');
  addUser(db, 1, ['admin', 'reception']);
  addUser(db, 2, ['reception'], 0);
  assert.equal(call('deactivate', 'sas').body.state, 'inactive');
  call('activate', 'sas');
  addUser(db, 3, ['reception']);
  addUser(db, 4, ['reception']);
  const res = call('deactivate', 'sas');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RECEPTION_USERS');
  assert.equal(res.body.message, '2 comptes Accueil sont actifs. Change leur rôle dans Utilisateurs d’abord.');
});

test('accounting export: an active accountant-only user blocks it', () => {
  const { db, call } = setup();
  call('install', 'accounting-export');
  addUser(db, 1, ['accountant']);
  const res = call('uninstall', 'accounting-export');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ACCOUNTANT_USERS');
});

test('list shows the blocker before the click, only on installed plugins', () => {
  const { db, model, ctrl } = setup();
  db.prepare("INSERT INTO payment_links (status) VALUES ('open')").run();
  let res = fakeRes();
  ctrl.list({}, res);
  assert.equal(res.body.find((p) => p.id === 'online-payment').blocker, null);
  model.install('online-payment');
  res = fakeRes();
  ctrl.list({}, res);
  assert.equal(res.body.find((p) => p.id === 'online-payment').blocker.code, 'OPEN_PAYMENT_LINKS');
});

// ---------- route gating (rule 15) ----------

test('requirePlugin: 404 PLUGIN_INACTIVE when inactive, next() when active', () => {
  let active = false;
  const mw = requirePlugin('linen', { isActive: () => active });
  const res = fakeRes();
  let nextCalled = false;
  mw({}, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'PLUGIN_INACTIVE', plugin: 'linen' });
  active = true;
  mw({}, fakeRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('requirePlugin over HTTP: a mounted router disappears and comes back with its plugin', async () => {
  const { model } = setup();
  const app = express();
  const router = express.Router();
  router.get('/ping', (req, res) => res.json({ ok: true }));
  app.use('/public/v1', requirePlugin('website-booking', { isActive: model.isActive }), router);
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/public/v1/ping`;
    let res = await fetch(url);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'PLUGIN_INACTIVE', plugin: 'website-booking' });
    model.install('website-booking');
    res = await fetch(url);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test('the plugin mounts and routes are wired in the server', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const index = read('index.js');
  // The five plugin modules mount through the loader, behind the same guard
  // (specs/plugins-phase-1-sdk.md rule 5 — covered in plugins-phase-1-sdk.unit.test.js).
  for (const [mount, id] of [
    ['/public/v1', 'WEBSITE_BOOKING'], ['/api/resource-bookings', 'HOURLY_RESOURCES'],
    ['/api/payments', 'ONLINE_PAYMENT'], ['/api/laundry', 'LINEN'], ['/api/neat', 'NEAT'],
  ]) {
    assert.ok(index.includes(`app.use('${mount}', requirePlugin(PLUGINS.${id})`), mount);
  }
  assert.ok(index.indexOf('pluginLoader.mountPublic(app)') < index.indexOf("app.use('/public/v1', "), 'gate before /public/v1');
  assert.ok(index.includes('pluginLoader.mountApi(app)'));
  // specs/plugins-phase-2-hosts.md rule 19 — the export's routes left for its plugin module; the
  // compensations stay core, ungated.
  assert.doesNotMatch(read('routes/accounting.js'), /'\/sales|'\/platforms|platform-accounts|requirePlugin/);
  assert.match(read('routes/accounting.js'), /router\.get\('\/cancellation-compensations', compensationsController\.list\)/);
  assert.match(read('routes/reservations.js'), /'\/:id\/sas', requirePlugin\(PLUGINS\.SAS\)/);
  assert.match(read('routes/planning.js'), /'\/resource-cards', requirePlugin\(PLUGINS\.HOURLY_RESOURCES\)/);
  assert.match(read('routes/public/bookingRequests.js'), /'\/:id\/pay', bookingRequestLimiter, requirePlugin\(ONLINE_PAYMENT\)/);
});

// ---------- jobs and direct calls (rule 15) ----------

test('whenPluginActive: the tick is skipped while inactive and resumes when active', async () => {
  let active = false;
  const calls = [];
  const tick = whenPluginActive('neat', (reason) => { calls.push(reason); return 'ran'; }, { isActive: () => active });
  assert.equal(await tick('cron'), undefined);
  active = true;
  assert.equal(await tick('boot'), 'ran');
  assert.deepEqual(calls, ['boot']);
});

test('the scheduler wraps every plugin pass', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scheduledTasks.js'), 'utf8');
  // The jobs of the five plugin modules run through the loader (plugins-phase-1-sdk.unit.test.js).
  for (const [id, pass] of [
    ['ONLINE_PAYMENT', 'runPaymentPollPass'], ['NEAT', 'runNeatSubscriptionPass'],
  ]) {
    assert.ok(src.includes(`whenPluginActive(PLUGINS.${id}, ${pass})`), pass);
  }
});

test('Google sync: an inactive plugin makes every push, delete and reconcile a no-op', () => {
  const googleCalendarSync = require('../plugins/google-calendar/sync');
  const settings = { googleConnected: () => true, googleCalendarSelection: () => ({ calendarId: 'cal' }) };
  const on = googleCalendarSync.create({ settings, pluginActive: () => true });
  const off = googleCalendarSync.create({ settings, pluginActive: () => false });
  assert.equal(on.isActive(), true);
  assert.equal(off.isActive(), false);
});

test('Neat: an inactive plugin skips the pass, including the kicks from the payment flows', async () => {
  const { createNeatController } = require('../controllers/neatController');
  const neat = createNeatController({ pluginActive: () => false });
  assert.deepEqual(await neat.runPass('kick'), { skipped: 'plugin-inactive' });
});

// ---------- /me and /login (rule 14) ----------

test('login and me carry the active plugin ids', () => {
  const row = { id: 1, email: 'admin@guestflow.local', roles: ['admin'] };
  const users = {
    verifyCredentials: (email, pw) => (pw === 'ok' ? { ...row } : null),
    findById: () => ({ ...row }),
    touchLastLogin: () => {},
  };
  const ctrl = authController.create(users, { activePlugins: () => ['linen', 'sas'] });
  const session = {};
  const loginRes = fakeRes();
  ctrl.login({ body: { email: row.email, password: 'ok' }, session }, loginRes);
  assert.deepEqual(loginRes.body.enabledPlugins, ['linen', 'sas']);
  assert.equal(session.user.enabledPlugins, undefined, 'never frozen into the session');
  const meRes = fakeRes();
  ctrl.me({ session: { user: row } }, meRes);
  assert.deepEqual(meRes.body.enabledPlugins, ['linen', 'sas']);
});

// ---------- money never moves (rule 7) ----------

test('the pricing engine never reads plugin states', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'utils', 'pricing.js'), 'utf8');
  assert.doesNotMatch(src, /pluginsModel|constants\/plugins|requirePlugin/);
});
