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
    ctx.data({ tables: ['engine_fixture_rows'], describe: () => [{ label: 'rows', count: 1 }] });
  },
};

function boot({ active = true } = {}) {
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
  plugins.install(ID);
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
