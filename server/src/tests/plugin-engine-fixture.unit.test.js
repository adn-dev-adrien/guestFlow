// specs/plugin-removal-resilience.md rule 5 — the plugin engine (mount, gate, jobs, settings, secrets,
// erasure) proved on a module of its own, so it is exercised whichever shipped plugins a cell removed.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');

const loader = require('../plugins/loader');
const registry = require('../plugins/sdk/registry');
const { buildModel: buildPluginsModel } = require('../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../models/pluginSettingsModel');
const { createController } = require('../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../utils/pluginsSchema');
const { isEncrypted } = require('../utils/encryption');

const ID = 'engine-fixture';
const ran = [];

const fixture = {
  id: ID,
  register(ctx) {
    ctx.migrations([{ name: 'rows', up: (db) => db.exec('CREATE TABLE IF NOT EXISTS engine_fixture_rows (x TEXT)') }]);
    ctx.settings.declare([{ key: 'token', secret: true }, { key: 'label' }]);
    const router = express.Router();
    router.get('/ping', (req, res) => res.json({ pong: true }));
    ctx.mount('/api/engine-fixture', router);
    ctx.jobs.every({ name: 'tick', intervalMs: 1000, run: () => { ran.push('tick'); } });
    ctx.events.on('reservation.updated', () => { ran.push('event'); });
    ctx.onActivate(() => { ran.push('activate'); });
    ctx.data({ tables: ['engine_fixture_rows'], describe: () => [{ label: 'rows', count: 1 }] });
  },
};

function boot({ active = true, installed = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER, role TEXT, PRIMARY KEY (userId, role));
  `);
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  const plugins = buildPluginsModel(db);
  if (installed) plugins.install(ID);
  if (!active) plugins.setEnabled(ID, false);
  registry.reset();
  registry.configure({ isActive: (id) => plugins.isActive(id), allows: () => true });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [fixture], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const app = express();
  app.use(express.json());
  loader.mountApi(app);
  return { db, app, plugins, settingsModel };
}

async function get(app, url) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

const fakeRes = () => ({
  statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
});

test('rule 5: the module’s route answers while it is active and 404 PLUGIN_INACTIVE once it is not', async () => {
  const { app, plugins } = boot();
  assert.deepEqual((await get(app, '/api/engine-fixture/ping')).body, { pong: true });
  plugins.setEnabled(ID, false);
  const off = await get(app, '/api/engine-fixture/ping');
  assert.equal(off.status, 404);
  assert.equal(off.body.error, 'PLUGIN_INACTIVE');
  registry.reset();
});

test('rule 5: its job runs while it is live and skips its tick when it is not', async () => {
  const { plugins } = boot();
  const ticks = [];
  loader.startJobs({ setIntervalFn: (fn) => ticks.push(fn), setTimeoutFn: () => {} });
  ran.length = 0;
  await ticks[0]();
  assert.deepEqual(ran, ['tick']);
  plugins.setEnabled(ID, false);
  await ticks[0]();
  assert.deepEqual(ran, ['tick']);
  registry.reset();
});

test('rule 17: the bus drops an event while the module is off — it is never replayed when it comes back', async () => {
  const { plugins } = boot();
  const eventBus = require('../plugins/sdk/eventBus');
  ran.length = 0;
  plugins.setEnabled(ID, false);
  await eventBus.dispatch('reservation.updated', { reservationId: 1 });
  plugins.setEnabled(ID, true);
  assert.deepEqual(ran, []);
  await eventBus.dispatch('reservation.updated', { reservationId: 1 });
  assert.deepEqual(ran, ['event']);
  registry.reset();
});

test('rule 17: onActivate runs when the module is activated or installed, never at boot or on deactivation', async () => {
  const { plugins, settingsModel, db } = boot();
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, licence: () => ({ allowsPlugin: () => true, planFor: () => null }) });
  ran.length = 0;
  controller.deactivate({ params: { id: ID }, query: {} }, fakeRes());
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ran, []);
  controller.activate({ params: { id: ID }, query: {} }, fakeRes());
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ran, ['activate']);
  registry.reset();
});

test('rule 17: an install of a catalogued plugin runs its activation hooks after its install hooks', async () => {
  const { listPlugins } = require('../plugins/sdk/testing');
  const id = listPlugins()[0];
  const { plugins, settingsModel, db } = boot({ installed: false });
  plugins.uninstall(ID);
  const mod = { ...fixture, id };
  registry.reset();
  registry.configure({ isActive: (x) => plugins.isActive(x), allows: () => true });
  loader.registerAll({ db, modules: [mod], settingsModel: () => settingsModel, isInstalled: (x) => Boolean(plugins.get(x)) });
  ran.length = 0;
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, licence: () => ({ allowsPlugin: () => true, planFor: () => null }) });
  const res = fakeRes();
  await controller.install({ params: { id }, query: {}, body: {} }, res);
  await new Promise((r) => setImmediate(r));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(ran, ['activate']);
  registry.reset();
});

test('rule 17: a live-set pass landing inside an install hook does not announce the plugin twice', async () => {
  const { listPlugins } = require('../plugins/sdk/testing');
  const id = listPlugins()[0];
  const { plugins, settingsModel, db } = boot({ installed: false });
  const mod = { ...fixture, id };
  const original = mod.register;
  mod.register = (ctx) => {
    original(ctx);
    ctx.onInstall(() => loader.syncLiveTransitions());
  };
  registry.reset();
  loader.resetLiveTransitionsForTests();
  registry.configure({ isActive: (x) => plugins.isActive(x), allows: () => true });
  loader.registerAll({ db, modules: [mod], settingsModel: () => settingsModel, isInstalled: (x) => Boolean(plugins.get(x)) });
  await loader.syncLiveTransitions();
  ran.length = 0;
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, licence: () => ({ allowsPlugin: () => true, planFor: () => null }) });
  await controller.install({ params: { id }, query: {}, body: {} }, fakeRes());
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ran.filter((x) => x === 'activate'), ['activate'], 'exactly one fire');
  controller.deactivate({ params: { id }, query: {} }, fakeRes());
  controller.activate({ params: { id }, query: {} }, fakeRes());
  await new Promise((r) => setImmediate(r));
  assert.equal(ran.filter((x) => x === 'activate').length, 2, 'a quick off and on is a new transition');
  registry.reset();
  loader.resetLiveTransitionsForTests();
});

test('rule 17: a plugin switched off while its install is still running is not announced', async () => {
  const { listPlugins } = require('../plugins/sdk/testing');
  const id = listPlugins()[0];
  const { plugins, settingsModel, db } = boot({ installed: false });
  const mod = { ...fixture, id };
  const original = mod.register;
  let controller;
  mod.register = (ctx) => {
    original(ctx);
    ctx.onInstall(() => controller.deactivate({ params: { id }, query: {} }, fakeRes()));
  };
  registry.reset();
  loader.resetLiveTransitionsForTests();
  registry.configure({ isActive: (x) => plugins.isActive(x), allows: () => true });
  loader.registerAll({ db, modules: [mod], settingsModel: () => settingsModel, isInstalled: (x) => Boolean(plugins.get(x)) });
  await loader.syncLiveTransitions();
  ran.length = 0;
  controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, licence: () => ({ allowsPlugin: () => true, planFor: () => null }) });
  await controller.install({ params: { id }, query: {}, body: {} }, fakeRes());
  await new Promise((r) => setImmediate(r));
  assert.equal(registry.isLive(id), false);
  assert.deepEqual(ran.filter((x) => x === 'activate'), [], 'no hook on a plugin that is off');
  controller.activate({ params: { id }, query: {} }, fakeRes());
  await new Promise((r) => setImmediate(r));
  assert.equal(ran.filter((x) => x === 'activate').length, 1, 'switching it on later announces it once');
  registry.reset();
  loader.resetLiveTransitionsForTests();
});

test('rule 5: a secret setting is encrypted at rest and only reads back as <key>Set over HTTP', () => {
  const { plugins, settingsModel, db } = boot();
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel });
  const res = fakeRes();
  controller.saveSettings({ params: { id: ID }, body: { token: ' s3cret ', label: 'ok' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(isEncrypted(settingsModel.raw(ID, 'token')));
  assert.equal(settingsModel.get(ID, 'token', { secret: true }), 's3cret');
  assert.equal(res.body.tokenSet, true);
  assert.equal(res.body.token, undefined);
  registry.reset();
});

test('rule 5: an erasure drops the module’s tables and settings, and the row goes', () => {
  const { plugins, settingsModel, db } = boot();
  db.prepare("INSERT INTO engine_fixture_rows (x) VALUES ('a')").run();
  settingsModel.set(ID, 'label', 'kept until erased', { secret: false });
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel });
  const res = fakeRes();
  controller.uninstall({ params: { id: ID }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'engine_fixture_rows'").get(), undefined);
  assert.equal(settingsModel.get(ID, 'label'), '');
  assert.equal(plugins.get(ID), null);
  registry.reset();
});
