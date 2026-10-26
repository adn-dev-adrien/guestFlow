// specs/google-vacation-rentals-feed.md rules 1, 2, 11, 12, 16, §4.3 — the plugin as the app mounts it:
// its routes behind the loader, its settings through the generic plugin settings endpoint, its event
// subscriptions, its setup state and its data. Real loader, real database in memory.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const silent = console.log;
console.log = () => {};
const db = require('../../../database');
console.log = silent;
const registry = require('../../sdk/registry');
const eventBus = require('../../sdk/eventBus');
const loader = require('../../loader');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { createController } = require('../../../controllers/pluginsController');
const gvr = require('..');
const { MIGRATIONS } = require('../model');

const ID = 'google-vacation-rentals';
const plugins = buildPluginsModel(db);
const settingsModel = buildPluginSettingsModel(db);

const propertyId = Number(db.prepare("INSERT INTO properties (name, maxGuests, basePriceIncludedGuests) VALUES ('La Granja', 4, 2)").run().lastInsertRowid);
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, dateRanges, minNights)
  VALUES (?, 'Toute l’année', 100, 'fixed', '[]', 1)`).run(propertyId);

function boot({ installed = [ID] } = {}) {
  registry.reset();
  db.prepare('DELETE FROM plugins').run();
  installed.forEach((id) => plugins.install(id));
  registry.configure({ isActive: (id) => plugins.isActive(id), allows: () => true });
  loader.registerAll({ db, modules: [gvr], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)), dataDir: () => require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'gvr-routes-')) });
  if (installed.includes(ID)) loader.migrate(db, ID);
  const app = express();
  app.use(express.json());
  loader.mountApi(app);
  return app;
}

async function call(app, method, url, body) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

function settingsCall(method, body) {
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, loader: () => loader });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller[method === 'PUT' ? 'saveSettings' : 'getSettings']({ params: { id: ID }, body }, res);
  return res;
}

test.beforeEach(() => { db.prepare('DELETE FROM plugin_settings WHERE plugin_id = ?').run(ID); });

test('rule 1 — the plugin owns its tables (created by its migration) and its prefix', async () => {
  assert.equal(MIGRATIONS.length, 1);
  const app = boot();
  ['gvr_rate_snapshot', 'gvr_day_snapshot', 'gvr_push_log'].forEach((table) => {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table);
  });
  const res = await call(app, 'GET', '/api/google-vacation-rentals/status');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['configured', 'enabledCount', 'lastCheck', 'lastError', 'mode', 'properties']);
  assert.equal(res.body.mode, 'simulation');
  assert.equal(res.body.configured, false);
  assert.deepEqual(res.body.properties[0], {
    id: propertyId, name: 'La Granja', enabled: false, hotelCode: 'la-granja', slug: 'la-granja', landingUrl: null,
    lastRunAt: null, lastResult: null, lastResultLabel: null, itineraries: 0, pendingDiff: 0, scheduled: false,
  });
});

test('rule 1 — inactive, the routes answer PLUGIN_INACTIVE', async () => {
  const app = boot({ installed: [] });
  const res = await call(app, 'GET', '/api/google-vacation-rentals/status');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'PLUGIN_INACTIVE');
});

test('rule 2 — the setup state says what is missing', () => {
  boot();
  const { setupStatus } = registry.get(ID);
  assert.equal(setupStatus(), 'identifiant partenaire manquant');
  settingsModel.set(ID, 'partnerId', 'solio_partner');
  assert.equal(setupStatus(), 'aucun logement activé');
  settingsModel.set(ID, 'properties', JSON.stringify({ [propertyId]: { enabled: true } }));
  assert.equal(setupStatus(), null);
});

test('rule 16 — the settings endpoint refuses Envoi without a partner id, and accepts it sent with one', () => {
  boot();
  const refused = settingsCall('PUT', { mode: 'envoi' });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.body, { error: 'INVALID_SETTING', errors: { mode: 'Envoi impossible : identifiant partenaire manquant.' } });
  const accepted = settingsCall('PUT', {
    partnerId: 'solio_partner', mode: 'envoi', properties: JSON.stringify({ [propertyId]: { enabled: true, hotelCode: 'solio-la-granja' } }),
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.mode, 'envoi');
  assert.equal(settingsCall('GET').body.partnerId, 'solio_partner');
});

test('§4.3 — push, check and log: 409 while no property is enabled, then a simulated run, a check and its log', async () => {
  const app = boot();
  assert.equal((await call(app, 'POST', '/api/google-vacation-rentals/push', {})).status, 409);
  assert.equal((await call(app, 'POST', '/api/google-vacation-rentals/check', {})).status, 409);
  settingsModel.set(ID, 'horizonDays', '30');
  settingsModel.set(ID, 'maxLos', '3');
  settingsModel.set(ID, 'properties', JSON.stringify({ [propertyId]: { enabled: true, hotelCode: 'solio-la-granja' } }));
  const pushed = await call(app, 'POST', '/api/google-vacation-rentals/push', { full: true });
  assert.equal(pushed.status, 200);
  assert.equal(pushed.body.mode, 'simulation');
  assert.equal(pushed.body.runs[0].result, 'simulated');
  assert.equal(pushed.body.runs[0].resultLabel, 'Simulé');
  // 30 arrivals × up to 3 nights × party sizes 2 to 4 (no tourist tax: one price up to the 2 included).
  assert.equal(pushed.body.runs[0].rates, (28 * 3 + 2 + 1) * 3);
  const checked = await call(app, 'POST', '/api/google-vacation-rentals/check', { samples: 50 });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.checked, 50);
  assert.deepEqual(checked.body.mismatches, []);
  const status = await call(app, 'GET', '/api/google-vacation-rentals/status');
  assert.equal(status.body.properties[0].lastResult, 'simulated');
  assert.equal(status.body.properties[0].itineraries, pushed.body.runs[0].rates);
  assert.equal(status.body.lastCheck.checked, 50);
  const log = await call(app, 'GET', '/api/google-vacation-rentals/log?limit=5');
  assert.equal(log.body.runs[0].propertyName, 'La Granja');
  assert.equal(log.body.runs[0].full, true);
  const unknown = await call(app, 'POST', '/api/google-vacation-rentals/push', { propertyId: 999 });
  assert.equal(unknown.status, 404);
});

test('rules 11-12 — reservation, iCal and pricing events schedule a run once a partner id is set', async () => {
  boot();
  settingsModel.set(ID, 'properties', JSON.stringify({ [propertyId]: { enabled: true } }));
  await eventBus.dispatch('pricing.changed', { propertyId, source: 'pricing' });
  const app = boot();
  let status = await call(app, 'GET', '/api/google-vacation-rentals/status');
  assert.equal(status.body.properties[0].scheduled, false, 'inert without a partner id (rule 2)');
  settingsModel.set(ID, 'partnerId', 'solio_partner');
  await eventBus.dispatch('pricing.changed', { propertyId: null, source: 'closures' });
  status = await call(app, 'GET', '/api/google-vacation-rentals/status');
  assert.equal(status.body.properties[0].scheduled, true);
  assert.deepEqual([...registry.get(ID).handlers.keys()].sort(), [
    'ical.imported', 'pricing.changed', 'reservation.cancelled', 'reservation.created', 'reservation.deleted', 'reservation.updated',
  ]);
  registry.get(ID).data.purge(db);
});

test('the data the plugin would erase is described', () => {
  boot();
  db.prepare("INSERT INTO gvr_push_log (propertyId, startedAt, mode) VALUES (?, '2027-01-01T00:00:00Z', 'simulation')").run(propertyId);
  const lines = registry.get(ID).data.describe(db);
  assert.ok(lines.some((l) => /passage/.test(l.label)));
  assert.deepEqual(registry.get(ID).data.tables, ['gvr_rate_snapshot', 'gvr_day_snapshot', 'gvr_push_log']);
});
