// specs/plugins-phase-3b-neat.md §3.C, §3.E — Neat becomes the neat plugin: it prices the insurance
// through the core's post-processor, mounts its routes at the URLs the card knows, runs its pass as a job
// woken by the core's events, keeps its settings in plugin_settings and its two tables, adds its block
// to the fiche, and its erasure warns about the subscriptions that live on at Neat.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const Database = require('better-sqlite3');
const express = require('express');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const registry = require('../../sdk/registry');
const loader = require('../../loader');
const neat = require('..');
const quotePostProcessors = require('../../../utils/quotePostProcessors');
const { reservationBlocks } = require('../../../utils/pluginReservationBlocks');
const { encrypt } = require('../../../utils/encryption');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { createController } = require('../../../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');
const { createTables } = require('../migrations');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');
const ID = 'neat';

// A v3.8 database: Neat configured in app_settings, its two tables already holding rows.
function v38Db() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  createTables(db);
  db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();
  db.prepare(`UPDATE app_settings SET neatEnvironment = 'production', neatClientId = 'cid', neatClientSecretEncrypted = ?,
    neatSalesChannelId = 'ch-1', neatContractId = 'c-1', neatPaymentMethodId = 'pm-1', neatMarginPercent = 30 WHERE id = 1`)
    .run(encrypt('sec'));
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, adults, platform)
    VALUES (5, 'reservation', 1, 1, '2026-11-10', '2026-11-12', 2, 'direct'), (6, 'reservation', 1, 1, '2026-12-10', '2026-12-12', 2, 'direct')`).run();
  db.prepare(`INSERT INTO neat_subscriptions (reservationId, environment, externalId, status, neatSubscriptionId, premiumAmount, billedAmount)
    VALUES (5, 'production', 'guestflow-5', 'active', 'sub-5', 17.5, 23), (6, 'production', 'guestflow-6', 'failed', NULL, NULL, NULL)`).run();
  db.prepare("INSERT INTO neat_price_cache (environment, contractId, fieldsHash, premium, fetchedAt) VALUES ('production', 'c-1', 'h', 17.5, '2026-10-01')").run();
  return db;
}

function boot(db, { installed = true, active = installed } = {}) {
  registry.reset();
  const plugins = buildPluginsModel(db);
  if (installed) {
    if (!plugins.get(ID)) plugins.install(ID);
    plugins.setEnabled(ID, active);
  }
  registry.configure({ isActive: (id) => plugins.isActive(id), allows: () => true });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [neat], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const app = express();
  app.use(express.json());
  loader.mountApi(app);
  return { app, plugins, settingsModel };
}

async function request(app, method, url) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test.afterEach(() => registry.reset());

test('rules 1, 7 — the module declares the insurance price; off, it offers and prices nothing', () => {
  const db = v38Db();
  boot(db);
  assert.equal(quotePostProcessors.insuranceOffered(), true);
  assert.equal(quotePostProcessors.declared().id, 'neat');
  assert.equal(quotePostProcessors.dynamicInsurance(), false, 'no contract fields nor mapping yet: the Options price');
  boot(db, { active: false });
  assert.equal(quotePostProcessors.insuranceOffered(), false);
  assert.equal(quotePostProcessors.declared(), null);
});

test('rule 8 — /api/neat answers at its URLs only while the plugin is live', async () => {
  const db = v38Db();
  const off = boot(db, { active: false });
  const inactive = await request(off.app, 'GET', '/api/neat/settings');
  assert.equal(inactive.status, 404);
  assert.equal(inactive.body.error, 'PLUGIN_INACTIVE');
  const on = boot(db);
  const settings = await request(on.app, 'GET', '/api/neat/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.body.clientId, 'cid');
  assert.equal(settings.body.clientSecretSet, true);
  assert.equal(settings.body.environment, 'production');
  assert.equal(settings.body.marginPercent, 30);
});

test('rules 10, 11, 19 — the 13 settings are copied once, the secret still encrypted; the tables keep their rows', () => {
  const db = v38Db();
  const { settingsModel } = boot(db);
  assert.notEqual(settingsModel.raw(ID, 'neatClientSecretEncrypted'), 'sec');
  assert.equal(settingsModel.get(ID, 'neatClientSecretEncrypted', { secret: true }), 'sec');
  assert.equal(settingsModel.get(ID, 'neatContractId'), 'c-1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM neat_subscriptions').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM neat_price_cache').get().n, 1);
});

test('rule 9 — the pass is the module’s job, woken by the core’s three events', () => {
  const db = v38Db();
  boot(db);
  const record = registry.get(ID);
  const job = record.jobs.find((j) => j.name === 'subscription-pass');
  assert.equal(job.intervalMs, 5 * 60 * 1000);
  assert.equal(job.bootDelayMs, 150 * 1000);
  assert.deepEqual([...record.handlers.keys()].sort(), ['reservation.created', 'reservation.paid', 'reservation.updated']);
});

test('rule 12 — the fiche block comes from the plugin, only while it is live', () => {
  const db = v38Db();
  boot(db);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = 5').get();
  const { neat: block } = reservationBlocks(reservation);
  assert.equal(block.status, 'line_removed_active', 'active at Neat, no insurance line on the stay');
  assert.equal(block.neatId, 'sub-5');
  assert.equal(block.marginPercent, 30);
  boot(db, { active: false });
  assert.deepEqual(reservationBlocks(reservation), {});
});

test('rule 13 — the push toggle « Souscriptions Neat » is available only while the plugin is live', () => {
  const prefs = { newReservation: true, arrivals: true, departures: true, breakfast: true, neat: false };
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    return id === '../models/pushSubscriptionsModel' ? { getPreferences: () => prefs } : original.call(this, id);
  };
  let controller;
  try {
    const m = '../../../controllers/pushController';
    delete require.cache[require.resolve(m)];
    controller = require(m);
  } finally {
    Module.prototype.require = original;
  }
  const db = v38Db();
  boot(db);
  const on = fakeRes();
  controller.getPreferences({ user: { id: 1 } }, on);
  assert.ok(on.body.available.includes('neat'));
  assert.equal(on.body.neat, false, 'the stored preference, as it is');
  boot(db, { active: false });
  const off = fakeRes();
  controller.getPreferences({ user: { id: 1 } }, off);
  assert.deepEqual(off.body.available, ['newReservation', 'arrivals', 'departures', 'breakfast']);
});

test('rule 14 — erasing warns about the active subscriptions first, then erases; a reinstall starts empty', async () => {
  const db = v38Db();
  const { plugins, settingsModel } = boot(db);
  const controller = createController(plugins, {
    registry, db: () => db, settingsModel: () => settingsModel, loader: () => ({ ...loader, runInstallHooks: async () => {} }),
  });
  const list = fakeRes();
  controller.list({}, list);
  const lines = list.body.find((p) => p.id === ID).data;
  assert.equal(lines[0].warning, true);
  assert.equal(lines[0].label, "1 souscription active, toujours en vigueur chez Neat");
  assert.deepEqual(lines.slice(1).map((l) => l.label), [
    'la connexion Neat (identifiants, contrat, mappage, marge)',
    '1 souscription en attente ou en échec',
    'le cache des primes',
  ]);

  const res = fakeRes();
  controller.uninstall({ params: { id: ID }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 200, 'warned, not refused (P12)');
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'neat_subscriptions'").get(), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plugin_settings WHERE plugin_id = ?').get(ID).n, 0);
  const legacy = db.prepare('SELECT neatClientId, neatEnvironment, neatMarginPercent FROM app_settings WHERE id = 1').get();
  assert.deepEqual({ ...legacy }, { neatClientId: '', neatEnvironment: 'staging', neatMarginPercent: null });

  await controller.install({ params: { id: ID } }, fakeRes());
  boot(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM neat_subscriptions').get().n, 0);
  assert.equal(settingsModel.get(ID, 'neatClientId'), '', 'the erased connection does not come back');
});

test('rule 20 — a new customer starts without the plugin: no insurance offered at all', () => {
  const db = v38Db();
  boot(db, { installed: false });
  assert.equal(quotePostProcessors.insuranceOffered(), false);
  assert.equal(quotePostProcessors.dynamicInsurance(), false);
});

test('rule 12 — a fiche block is keyed by its plugin’s id, the key the fiche reads it under', () => {
  const { createContext } = require('../../sdk/createContext');
  const ctx = createContext('neat', { db: v38Db(), settingsModel: () => buildPluginSettingsModel(v38Db()) });
  assert.throws(() => ctx.reservationBlock('insurance', () => null), /keyed by the plugin id \("neat"\)/);
  assert.doesNotThrow(() => ctx.reservationBlock('neat', () => null));
  registry.reset();
});
