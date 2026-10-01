// specs/plugins-phase-2-hosts.md §3.F (rules 23-27) and the website part of §3.G (rules 28-29): the
// website-booking module owns /public/v1 except /public/v1/gate, its API key, the « Demandes du site »
// alert and the CGV enforcement switch. Real routers, real controllers and a real in-memory database,
// driven over HTTP through the plugin loader — as index.js mounts them.

// Before anything loads: the core models bind to this database, the limiter reads its threshold once.
process.env.DB_PATH = ':memory:';
process.env.PUBLIC_API_KEY = 'phase-2-website-key';
process.env.PUBLIC_API_RATELIMIT_MAX = '50';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const loader = require('../../loader');
const localEnv = require('../../../utils/localEnv');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { createController } = require('../../../controllers/pluginsController');
const termsModel = require('../../../models/termsModel');
const settings = require('../settings');
const { checkTermsAcceptance } = require('../controllers/publicBookingRequestController');
const gateAccess = require('../../gate-access');
const websiteBooking = require('..');

const ID = 'website-booking';
const SRC = path.join(__dirname, '..', '..', '..');
const KEY = { authorization: `Bearer ${process.env.PUBLIC_API_KEY}` };

const plugins = buildPluginsModel(db);
const settingsModel = buildPluginSettingsModel(db);

// The plugins installed and active for one test; the two modules registered as index.js does.
function boot({ installed = [], modules = [gateAccess, websiteBooking] } = {}) {
  registry.reset();
  db.prepare('DELETE FROM plugins').run();
  installed.forEach((id) => plugins.install(id));
  registry.configure({ isActive: (id) => plugins.isActive(id), allows: () => true });
  loader.registerAll({ db, modules, settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const app = express();
  app.use(express.json());
  loader.mountPublic(app);
  app.use('/api/dashboard', require('../../../routes/dashboard'));
  app.use('/api/terms', require('../../../routes/terms'));
  loader.mountApi(app);
  return app;
}

async function call(app, method, url, { headers = {}, body } = {}) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

const visitor = (ip) => ({ ...KEY, 'x-guestflow-visitor-ip': ip });
const inactive = (plugin) => ({ error: 'PLUGIN_INACTIVE', plugin });

// A stub secrets store: sdk.secrets reads `getOrCreateSecret` off the module at call time, so the
// real server/.env.local is never touched.
function withSecretsSpy(fn) {
  const calls = [];
  const original = localEnv.getOrCreateSecret;
  localEnv.getOrCreateSecret = (name) => { calls.push(name); return 'stub'; };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => { localEnv.getOrCreateSecret = original; });
}

test('specs/plugins-phase-2-hosts.md rule 23 — every /public/v1 prefix answers 404 PLUGIN_INACTIVE while website-booking is off, and /public/v1/gate still answers', () => withSecretsSpy(async () => {
  const app = boot({ installed: ['gate-access'] });
  for (const [method, url] of [
    ['GET', '/public/v1/properties'], ['GET', '/public/v1/properties/1/availability'], ['GET', '/public/v1/terms'],
    ['POST', '/public/v1/quote'], ['POST', '/public/v1/booking-requests'], ['GET', '/public/v1/plugin-update'],
  ]) {
    const res = await call(app, method, url, { headers: KEY, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 404, url);
    assert.deepEqual(res.body, inactive(ID), url);
  }
  const gate = await call(app, 'GET', '/public/v1/gate/ping');
  assert.notDeepEqual(gate.body, inactive(ID), 'the gate is not behind the website plugin');
  assert.notEqual(gate.body && gate.body.error, 'PLUGIN_INACTIVE');
}));

test('specs/plugins-phase-2-hosts.md rule 23 — once installed, the same paths answer behind the API key', () => withSecretsSpy(async () => {
  const app = boot({ installed: [ID] });
  assert.equal((await call(app, 'GET', '/public/v1/properties')).status, 401, 'the key is checked first');
  const list = await call(app, 'GET', '/public/v1/properties', { headers: visitor('198.51.100.1') });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, { data: [] });
  const terms = await call(app, 'GET', '/public/v1/terms', { headers: visitor('198.51.100.1') });
  assert.equal(terms.body.error.code, 'TERMS_NOT_CONFIGURED');
  const gate = await call(app, 'GET', '/public/v1/gate/ping');
  assert.deepEqual(gate.body, inactive('gate-access'), 'gate-access keeps its own switch');
}));

test('specs/plugins-phase-2-hosts.md rule 23 — /booking-requests/:id/pay and /status need website-booking AND online-payment', () => withSecretsSpy(async () => {
  let app = boot({ installed: [ID] });
  for (const [method, url] of [['POST', '/public/v1/booking-requests/1/pay'], ['GET', '/public/v1/booking-requests/1/status']]) {
    const res = await call(app, method, url, { headers: visitor('198.51.100.2'), body: method === 'POST' ? {} : undefined });
    assert.deepEqual(res.body, inactive('online-payment'), url);
  }
  app = boot({ installed: ['online-payment'] });
  const off = await call(app, 'GET', '/public/v1/booking-requests/1/status', { headers: visitor('198.51.100.2') });
  assert.deepEqual(off.body, inactive(ID));
  app = boot({ installed: [ID, 'online-payment'] });
  const both = await call(app, 'GET', '/public/v1/booking-requests/1/status', { headers: visitor('198.51.100.2') });
  assert.notEqual(both.body && both.body.error, 'PLUGIN_INACTIVE', 'the core handler answers');
}));

test('specs/plugins-phase-2-hosts.md rule 23 — the shared public limiter counts a request once', () => withSecretsSpy(async () => {
  const app = boot({ installed: [ID, 'gate-access'] });
  const ip = '198.51.100.3';
  const remaining = [];
  for (const url of ['/public/v1/properties', '/public/v1/terms', '/public/v1/plugin-update']) {
    const res = await call(app, 'GET', url, { headers: visitor(ip) });
    remaining.push(Number(res.headers.get('ratelimit-remaining')));
  }
  assert.deepEqual(remaining, [49, 48, 47]);
}));

test('specs/plugins-phase-2-hosts.md rules 24, 29 — the API key is created on install and at the boot of an installed plugin only', () => withSecretsSpy(async (calls) => {
  boot({ installed: [] });
  assert.deepEqual(calls.filter((n) => n === 'PUBLIC_API_KEY'), [], 'not installed: no key at boot');
  await loader.runInstallHooks(ID);
  assert.deepEqual(calls.filter((n) => n === 'PUBLIC_API_KEY'), ['PUBLIC_API_KEY'], 'created on install');
  calls.length = 0;
  boot({ installed: [ID] });
  assert.deepEqual(calls.filter((n) => n === 'PUBLIC_API_KEY'), ['PUBLIC_API_KEY'], 'ensured at the boot of an installed plugin');
  const index = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  assert.ok(!index.includes("getOrCreateSecret('PUBLIC_API_KEY'"), 'rule 29: the core boot no longer creates it');
}));

test('specs/plugins-phase-2-hosts.md rule 25 — the pending website requests answer 404 while the plugin is off (gap 2)', () => withSecretsSpy(async () => {
  let app = boot({ installed: [] });
  const off = await call(app, 'GET', '/api/dashboard/public-devis-pending');
  assert.equal(off.status, 404);
  assert.deepEqual(off.body, inactive(ID));
  app = boot({ installed: [ID] });
  const on = await call(app, 'GET', '/api/dashboard/public-devis-pending');
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { alerts: [] });
}));

test('specs/plugins-phase-2-hosts.md rule 25 — the enforcement reads and writes plugin_settings, not app_settings', () => withSecretsSpy(async () => {
  db.prepare("DELETE FROM plugin_settings WHERE plugin_id = 'website-booking'").run();
  let app = boot({ installed: [] });
  assert.deepEqual((await call(app, 'PUT', '/api/terms/enforcement', { body: { requireTermsAcceptance: false } })).body, inactive(ID));

  app = boot({ installed: [ID] });
  settingsModel.set(ID, 'requireTermsAcceptance', '0');
  settingsModel.set(ID, 'lastSeenPluginVersion', '1.7.0');
  const read = await call(app, 'GET', '/api/terms/online-booking');
  assert.equal(read.body.requireTermsAcceptance, false);
  assert.equal(read.body.lastSeenPluginVersion, '1.7.0');
  assert.equal(read.body.pluginOutdated, true);
  assert.equal(read.body.outdatedPluginBlocks, false);
  assert.equal(checkTermsAcceptance(undefined).error, undefined, 'the booking request reads the same switch');

  const before = db.prepare('SELECT requireTermsAcceptance FROM app_settings WHERE id = 1').get();
  const put = await call(app, 'PUT', '/api/terms/enforcement', { body: { requireTermsAcceptance: true } });
  assert.equal(put.body.requireTermsAcceptance, true);
  assert.equal(settingsModel.get(ID, 'requireTermsAcceptance'), '1');
  assert.deepEqual(db.prepare('SELECT requireTermsAcceptance FROM app_settings WHERE id = 1').get(), before, 'the old column is not written');
  assert.equal(checkTermsAcceptance(undefined).code, 'TERMS_NOT_CONFIGURED');

  const overview = await call(app, 'GET', '/api/terms');
  for (const gone of ['requireTermsAcceptance', 'lastSeenPluginVersion', 'pluginOutdated', 'minPluginVersion']) {
    assert.equal(Object.prototype.hasOwnProperty.call(overview.body, gone), false, `the CGV overview no longer carries ${gone}`);
  }
}));

test('specs/plugins-phase-2-hosts.md rule 28 — the plugin copies its two app_settings once, skipping empty values', () => withSecretsSpy(async () => {
  db.prepare("DELETE FROM plugin_settings WHERE plugin_id = 'website-booking'").run();
  db.prepare("DELETE FROM migrations WHERE name LIKE 'plugin:website-booking:%'").run();
  db.prepare("UPDATE app_settings SET requireTermsAcceptance = 0, lastSeenPluginVersion = '' WHERE id = 1").run();
  boot({ installed: [] });
  assert.equal(loader.migrate(db, ID), 1);
  assert.equal(settingsModel.raw(ID, 'requireTermsAcceptance'), '0');
  assert.equal(settingsModel.raw(ID, 'lastSeenPluginVersion'), '', 'an empty value is not copied');

  db.prepare("UPDATE app_settings SET requireTermsAcceptance = 1, lastSeenPluginVersion = '1.9.0' WHERE id = 1").run();
  assert.equal(loader.migrate(db, ID), 0, 'runs once');
  assert.equal(settingsModel.raw(ID, 'requireTermsAcceptance'), '0');
  assert.equal(settingsModel.raw(ID, 'lastSeenPluginVersion'), '');
  db.prepare("UPDATE app_settings SET requireTermsAcceptance = 1, lastSeenPluginVersion = '' WHERE id = 1").run();
}));

test('specs/plugins-phase-2-hosts.md rule 27 — the erasure lists and resets the two settings and keeps devis, acceptances and the key', () => withSecretsSpy(async (calls) => {
  db.prepare("DELETE FROM plugin_settings WHERE plugin_id = 'website-booking'").run();
  boot({ installed: [ID] });
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, loader: () => loader });
  const listed = () => {
    const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
    controller.list({}, res);
    return res.body.find((p) => p.id === ID);
  };
  assert.equal(listed().erasable, true);
  assert.deepEqual(listed().data, [], 'defaults only: nothing to erase');

  settingsModel.set(ID, 'requireTermsAcceptance', '0');
  settingsModel.set(ID, 'lastSeenPluginVersion', '1.8.0');
  db.prepare("UPDATE app_settings SET requireTermsAcceptance = 0, lastSeenPluginVersion = '1.8.0' WHERE id = 1").run();
  assert.deepEqual(listed().data.map((l) => l.label), ['le réglage d’exigence des CGV', 'la dernière version du plugin WordPress vue']);

  const clientId = db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Marie', 'Durand')").run().lastInsertRowid;
  const propertyId = db.prepare("INSERT INTO properties (name) VALUES ('La Granja')").run().lastInsertRowid;
  const reservationId = db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, requestOrigin, publicToken) VALUES (?, ?, '2026-10-12', '2026-10-15', 'public', 'tok')")
    .run(propertyId, clientId).lastInsertRowid;
  const version = termsModel.publishVersion({
    markdownFr: 'fr', markdownEn: 'en', htmlFr: '<p>fr</p>', htmlEn: '<p>en</p>', variables: {}, contentHash: 'h', publishedAt: '2026-09-01T08:00:00Z', publishedBy: null,
  });
  termsModel.insertAcceptance({ reservationId, termsVersionId: version.id, version: version.version, acceptedAt: '2026-09-22T08:00:00Z' });

  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  calls.length = 0;
  controller.uninstall({ params: { id: ID }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(settingsModel.raw(ID, 'requireTermsAcceptance'), '');
  assert.equal(settingsModel.raw(ID, 'lastSeenPluginVersion'), '');
  assert.deepEqual(db.prepare('SELECT requireTermsAcceptance, lastSeenPluginVersion FROM app_settings WHERE id = 1').get(),
    { requireTermsAcceptance: 1, lastSeenPluginVersion: '' }, 'a reinstall copies nothing back');
  assert.equal(db.prepare('SELECT publicToken FROM reservations WHERE id = ?').get(reservationId).publicToken, 'tok', 'the devis and its token stay');
  assert.ok(termsModel.findAcceptanceByReservation(reservationId), 'the acceptance stays');
  assert.deepEqual(calls, [], 'the API key is not rotated');

  await controller.install({ params: { id: ID } }, { status() { return this; }, json() { return this; } });
  assert.equal(settings.termsSettings().requireTermsAcceptance, true, 'back to « on » after a reinstall');
  assert.equal(settings.termsSettings().lastSeenPluginVersion, '');
}));
