// specs/plugins-phase-3a-online-payment.md §3.C, §3.E — Qonto becomes the online-payment plugin: it
// declares the payment provider, mounts its routes and its webhook at the URLs Qonto knows, runs the
// poll as its job, keeps its settings in plugin_settings, and its erasure keeps every payment.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const express = require('express');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const registry = require('../../sdk/registry');
const loader = require('../../loader');
const onlinePayment = require('..');
const paymentProviders = require('../../../utils/paymentProviders');
const { encrypt } = require('../../../utils/encryption');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const paymentLinksModel = require('../../../models/paymentLinksModel');
const { createController } = require('../../../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');
const { current: currentStore } = require('../settingsStore');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');
const ID = 'online-payment';

// A v3.8 database: the Qonto connection still in app_settings, the secrets encrypted there.
function v38Db() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();
  db.prepare(`UPDATE app_settings SET qontoClientId = 'cid', qontoClientSecretEncrypted = ?, qontoRefreshTokenEncrypted = ?,
    qontoAccessTokenEncrypted = ?, qontoWebhookSecretEncrypted = ?, qontoConnectionStatus = 'enabled',
    qontoWebhookSubscriptionId = 'sub_1', publicSiteOrigin = 'https://www.domainesolio.com' WHERE id = 1`)
    .run(encrypt('sec'), encrypt('rt'), encrypt('at'), encrypt('whsec'));
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount)
    VALUES (5, 'reservation', 1, 1, '2026-11-10', '2026-11-12', 2, 300, 90, 210)`).run();
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
  loader.registerAll({ db, modules: [onlinePayment], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  loader.mountApi(app);
  return { app, plugins };
}

async function request(app, method, url, body) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test.afterEach(() => registry.reset());

test('rules 4, 10 — the module declares Qonto as the payment provider, ready once connected', () => {
  const db = v38Db();
  boot(db);
  const provider = paymentProviders.active();
  assert.equal(provider.id, 'qonto');
  assert.equal(provider.errorCode, 'QONTO_API_ERROR', 'the WordPress contract keeps its code');
  boot(db, { active: false });
  assert.equal(paymentProviders.active(), null, 'plugin off: no provider');
});

test('rules 11, 12 — the routes and the webhook answer at the URLs Qonto and the page know, only while live', async () => {
  const db = v38Db();
  const off = boot(db, { active: false });
  assert.equal(loader.isWebhook('POST', '/payments/qonto/webhook'), true);
  assert.equal(loader.isWebhook('GET', '/payments/qonto/webhook'), false);
  const inactive = await request(off.app, 'POST', '/api/payments/qonto/webhook', { data: { payment_link_id: 'x' } });
  assert.equal(inactive.status, 404);
  assert.equal(inactive.body.error, 'PLUGIN_INACTIVE');
  assert.equal((await request(off.app, 'GET', '/api/payments/settings')).status, 404);

  const on = boot(db);
  const unsigned = await request(on.app, 'POST', '/api/payments/qonto/webhook', { data: { payment_link_id: 'x' } });
  assert.equal(unsigned.status, 401, 'the plugin authenticates its webhook itself');
  const settings = await request(on.app, 'GET', '/api/payments/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.body.credentials.clientId, 'cid');
});

test('rule 13 — the 19 Qonto settings are copied once into plugin_settings, secrets still encrypted and readable', () => {
  const db = v38Db();
  boot(db);
  const raw = db.prepare("SELECT value FROM plugin_settings WHERE plugin_id = ? AND key = 'qontoRefreshTokenEncrypted'").get(ID).value;
  assert.notEqual(raw, 'rt');
  const store = currentStore();
  assert.equal(store.qontoTokens().refreshToken, 'rt');
  assert.equal(store.qontoCredentials().clientSecret, 'sec');
  assert.equal(store.qontoCredentials().webhookSecret, 'whsec');
  assert.equal(store.qontoWebhookSubscription().id, 'sub_1');
  assert.equal(store.qontoConnectionInfo().connectionStatus, 'enabled');
  assert.equal(store.qontoCredentials().publicSiteOrigin, 'https://www.domainesolio.com', 'read from the core');
});

test('rule 14 — the poll is the module’s job: today’s cadence, and nothing while Qonto is not connected', async () => {
  const db = v38Db();
  db.prepare("UPDATE app_settings SET qontoRefreshTokenEncrypted = '' WHERE id = 1").run();
  boot(db);
  const job = registry.get(ID).jobs.find((j) => j.name === 'payment-poll');
  assert.equal(job.intervalMs, 8 * 60 * 60 * 1000);
  assert.equal(job.bootDelayMs, 110 * 1000);
  assert.equal(await job.run(), undefined, 'no connection, no call');
});

test('rule 16 — the erasure forgets the connection and keeps every payment; the reinstall starts empty', async () => {
  const db = v38Db();
  const { plugins } = boot(db);
  const links = paymentLinksModel.buildModel(db);
  links.markPaid(links.create({ reservationId: 5, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_1', url: 'u' }).id, { providerPaymentId: 'pay_1' });
  db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2026-10-01' WHERE id = 5").run();

  const controller = createController(plugins, {
    registry, db: () => db, settingsModel: () => buildPluginSettingsModel(db), loader: () => ({ ...loader, runInstallHooks: async () => {} }),
  });
  const res = fakeRes();
  controller.uninstall({ params: { id: ID }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plugin_settings WHERE plugin_id = ?').get(ID).n, 0);
  assert.equal(db.prepare('SELECT qontoRefreshTokenEncrypted AS t FROM app_settings WHERE id = 1').get().t, '');
  assert.equal(db.prepare('SELECT publicSiteOrigin AS o FROM app_settings WHERE id = 1').get().o, 'https://www.domainesolio.com', 'core setting kept');
  assert.equal(links.findByProviderLinkId('qonto', 'ql_1').status, 'paid', 'the payment trace stays');
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = 5').get().depositPaid, 1);

  await controller.install({ params: { id: ID } }, fakeRes());
  boot(db);
  assert.equal(currentStore().qontoConnected(), false, 'the erased connection does not come back');
});

test('rule 16 — deactivating is still refused while a link is open', () => {
  const db = v38Db();
  const { plugins } = boot(db);
  paymentLinksModel.buildModel(db).create({ reservationId: 5, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_open', url: 'u' });
  const res = fakeRes();
  createController(plugins, { registry, db: () => db }).deactivate({ params: { id: ID } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'OPEN_PAYMENT_LINKS');
});

test('specs/plugins-phase-3a-online-payment.md rule 21 — a new customer starts without the plugin: no provider, nothing to ask for', async () => {
  const db = v38Db();
  boot(db, { installed: false });
  assert.equal(paymentProviders.active(), null);
  assert.equal(paymentProviders.declared(), null);
  assert.equal(paymentProviders.summary(), null, 'the fiche shows no payment button');
});
