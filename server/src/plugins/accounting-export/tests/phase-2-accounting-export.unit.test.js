// specs/plugins-phase-2-hosts.md §3.E — the accounting export becomes a plugin module: its routes
// answer only while it is live, the accountant reaches them only through it, its four settings live in
// plugin_settings, and its erasure resets configuration without touching a single accounting fact.
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
const accountingExport = require('..');
const { createAccountSettings } = require('../settings');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { buildModel: buildCompensationsModel } = require('../../../models/cancellationCompensationsModel');
const { createController } = require('../../../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');
const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');
const ID = 'accounting-export';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Dupont', 'marie@example.com')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, platform,
       finalPrice, totalPrice, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balanceDueDate)
    VALUES (10, 'reservation', 1, 1, '2026-09-18', '2026-09-25', 'direct', 914, 914, 274, 1, '2026-09-05', 640, 0, '2026-09-11')
  `).run();
  db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('direct')").run();
  db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('Airbnb')").run();
  db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('Booking.com')").run();
  return db;
}

// A received indemnity in September 2026: a journal entry the export reads, never writes.
function bankCompensation(db) {
  const compensations = buildCompensationsModel(db);
  const created = compensations.create({
    propertyName: 'Le Lodge', platform: 'Airbnb', clientFirstName: 'Claire', clientLastName: 'Notin',
    startDate: '2026-10-04', endDate: '2026-10-07', cancelledStayAmount: 612.5, expectedAmount: 84,
    expectedDate: '2026-09-20', notes: '',
  });
  compensations.receive(created.id, { receivedAmount: 84, receivedDate: '2026-09-22' });
}

// Boots the module on `db`. `user` (roles) puts the role guard in front, as index.js does.
function boot(db, { installed = true, active = installed, user = null } = {}) {
  registry.reset();
  const plugins = buildPluginsModel(db);
  if (installed) {
    if (!plugins.get(ID)) plugins.install(ID);
    plugins.setEnabled(ID, active);
  }
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [accountingExport], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const app = express();
  app.use(express.json());
  if (user) {
    app.use('/api', (req, res, next) => { req.user = user; next(); });
    app.use('/api', enforceRoleAccess);
  }
  app.use('/api/accounting', require('../../../routes/accounting'));
  loader.mountApi(app);
  return { app, plugins, settingsModel };
}

async function request(app, method, url, body) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text };
  } finally {
    server.close();
  }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const EXPORT_ROUTES = [
  ['GET', '/api/accounting/sales.csv?month=9&year=2026'],
  ['GET', '/api/accounting/sales?month=9&year=2026'],
  ['GET', '/api/accounting/platforms?month=9&year=2026'],
  ['GET', '/api/accounting/platform-accounts'],
  ['PUT', '/api/accounting/platform-accounts'],
  ['POST', '/api/accounting/platform-accounts/refresh'],
];

test('specs/plugins-phase-2-hosts.md rule 19 — the export routes answer 404 PLUGIN_INACTIVE while the plugin is off; the compensations stay reachable', async () => {
  const db = freshDb();
  const { app } = boot(db, { installed: true, active: false });
  for (const [method, url] of EXPORT_ROUTES) {
    const res = await request(app, method, url, method === 'PUT' ? { defaultAccount: '622600', platforms: [] } : undefined);
    assert.equal(res.status, 404, `${method} ${url}`);
    assert.equal(res.body.error, 'PLUGIN_INACTIVE', `${method} ${url}`);
  }
  const compensations = await request(app, 'GET', '/api/accounting/cancellation-compensations?month=9&year=2026');
  assert.notEqual(compensations.status, 404, 'the compensations are core: no plugin gate');
  assert.notEqual(compensations.body && compensations.body.error, 'PLUGIN_INACTIVE');

  const live = boot(db, { installed: true, active: true });
  const sales = await request(live.app, 'GET', '/api/accounting/sales?month=9&year=2026');
  assert.equal(sales.status, 200);
  assert.equal(sales.body.totals.entriesCount, 1);
  db.close();
});

test('specs/plugins-phase-2-hosts.md rule 3 — the accountant reaches the export only while accounting-export is live, and still reads the compensations', async () => {
  const db = freshDb();
  const accountant = { roles: ['accountant'] };

  const live = boot(db, { installed: true, active: true, user: accountant });
  assert.equal((await request(live.app, 'GET', '/api/accounting/sales?month=9&year=2026')).status, 200);
  assert.equal((await request(live.app, 'GET', '/api/accounting/sales.csv?month=9&year=2026')).status, 200);
  assert.equal((await request(live.app, 'GET', '/api/accounting/platform-accounts')).status, 200);
  assert.equal((await request(live.app, 'PUT', '/api/accounting/platform-accounts', { defaultAccount: '622600', platforms: [] })).status, 200);
  assert.equal((await request(live.app, 'POST', '/api/accounting/platform-accounts/refresh')).status, 200);
  // The accountant never writes a compensation, and never reaches anything else.
  const write = await request(live.app, 'POST', '/api/accounting/cancellation-compensations', {});
  assert.equal(write.status, 403);
  assert.equal(write.body.error, 'FORBIDDEN_ROLE');
  assert.equal((await request(live.app, 'POST', '/api/accounting/sales')).status, 403);

  const off = boot(db, { installed: true, active: false, user: accountant });
  const sales = await request(off.app, 'GET', '/api/accounting/sales?month=9&year=2026');
  assert.equal(sales.status, 404);
  assert.equal(sales.body.error, 'PLUGIN_INACTIVE');
  const read = await request(off.app, 'GET', '/api/accounting/cancellation-compensations?month=9&year=2026');
  assert.notEqual(read.status, 403, 'the compensations read is a core entry of the accountant');
  assert.notEqual(read.status, 404);
  db.close();
});

test('specs/plugins-phase-2-hosts.md rule 19 — the four account and VAT settings are read from and written to plugin_settings', async () => {
  const db = freshDb();
  // The old columns hold other values: they are no longer read.
  db.prepare("UPDATE app_settings SET defaultCommissionAccountNumber = '62269999', vatRateCommission = 5.5 WHERE id = 1").run();
  const { app } = boot(db, { installed: false });
  const settings = createAccountSettings(db);
  settings.write({ defaultCommissionAccountNumber: '62260001', vatRateCommission: 19.6, cancellationCompensationAccount: '75880100' });
  buildPluginsModel(db).install(ID);

  const get = await request(app, 'GET', '/api/accounting/platform-accounts');
  assert.equal(get.status, 200);
  assert.equal(get.body.defaultAccount, '62260001');
  assert.equal(get.body.vatRateCommission, 19.6);
  assert.equal(get.body.cancellationCompensationAccount, '75880100');
  assert.equal(get.body.vatRateCancellationCompensation, 0, 'an absent key reads its default');

  const put = await request(app, 'PUT', '/api/accounting/platform-accounts', {
    defaultAccount: '62260002', vatRateCancellationCompensation: '5,5', platforms: [],
  });
  assert.equal(put.status, 200);
  const stored = Object.fromEntries(db.prepare('SELECT key, value FROM plugin_settings WHERE plugin_id = ?').all(ID).map((r) => [r.key, r.value]));
  assert.equal(stored.defaultCommissionAccountNumber, '62260002');
  assert.equal(stored.vatRateCancellationCompensation, '5.5');
  const legacy = db.prepare('SELECT defaultCommissionAccountNumber, vatRateCancellationCompensation FROM app_settings WHERE id = 1').get();
  assert.deepEqual(legacy, { defaultCommissionAccountNumber: '62269999', vatRateCancellationCompensation: 0 }, 'app_settings untouched');

  // The journal books the compensation on the plugin's account.
  bankCompensation(db);
  const sales = await request(app, 'GET', '/api/accounting/sales?month=9&year=2026');
  assert.ok(sales.text.includes('75880100'), 'the produit account comes from plugin_settings');

  // The generic settings endpoint of phase 1 serves the same four keys.
  const controller = createController(buildPluginsModel(db), { registry, settingsModel: () => buildPluginSettingsModel(db) });
  const res = fakeRes();
  controller.getSettings({ params: { id: ID } }, res);
  assert.deepEqual(Object.keys(res.body).sort(), [
    'cancellationCompensationAccount', 'defaultCommissionAccountNumber', 'vatRateCancellationCompensation', 'vatRateCommission',
  ]);
  assert.equal(res.body.defaultCommissionAccountNumber, '62260002');
  db.close();
});

test('specs/plugins-phase-2-hosts.md rule 28 — the app_settings values are copied once into plugin_settings; empty values are skipped', () => {
  const db = freshDb();
  db.prepare(`UPDATE app_settings SET defaultCommissionAccountNumber = '62260003', vatRateCommission = 19.6,
    cancellationCompensationAccount = '', vatRateCancellationCompensation = 5.5 WHERE id = 1`).run();
  boot(db, { installed: true });
  const stored = Object.fromEntries(db.prepare('SELECT key, value FROM plugin_settings WHERE plugin_id = ?').all(ID).map((r) => [r.key, r.value]));
  assert.deepEqual(stored, { defaultCommissionAccountNumber: '62260003', vatRateCommission: '19.6', vatRateCancellationCompensation: '5.5' });
  assert.equal(createAccountSettings(db).read().cancellationCompensationAccount, '75880000', 'an empty value is not copied: the default reads');
  assert.ok(db.prepare(`SELECT 1 FROM migrations WHERE name = 'plugin:${ID}:settings_from_app_settings_v1'`).get());

  // Once: a later change of the old column, or a second boot, copies nothing.
  db.prepare("UPDATE app_settings SET defaultCommissionAccountNumber = '62260004' WHERE id = 1").run();
  boot(db, { installed: true });
  assert.equal(createAccountSettings(db).read().defaultCommissionAccountNumber, '62260003');
  db.close();
});

test('specs/plugins-phase-2-hosts.md rule 28 — a value already in plugin_settings is never overwritten by the copy', () => {
  const db = freshDb();
  db.prepare("UPDATE app_settings SET defaultCommissionAccountNumber = '62260003' WHERE id = 1").run();
  createAccountSettings(db).write({ defaultCommissionAccountNumber: '62260009' });
  boot(db, { installed: true });
  assert.equal(createAccountSettings(db).read().defaultCommissionAccountNumber, '62260009');
  db.close();
});

test('specs/plugins-phase-2-hosts.md rule 22 — describe lists the configured platforms and the changed defaults, zero lines left out', () => {
  const db = freshDb();
  const { plugins } = boot(db, { installed: true });
  const list = () => {
    const res = fakeRes();
    createController(plugins, { registry, db: () => db }).list({}, res);
    return res.body.find((p) => p.id === ID);
  };
  // The copy brought the shipped defaults: nothing to erase yet.
  assert.equal(list().erasable, true);
  assert.deepEqual(list().data, []);

  db.prepare("UPDATE platforms SET commissionAccountNumber = '62260300' WHERE name = 'Airbnb'").run();
  db.prepare("UPDATE platforms SET hasVatOnCommission = 1 WHERE name = 'Booking.com'").run();
  db.prepare("UPDATE platforms SET commissionAccountNumber = '99999999', hasVatOnCommission = 1 WHERE name = 'direct'").run();
  createAccountSettings(db).write({ vatRateCommission: 19.6 });
  assert.deepEqual(list().data, [
    { label: 'les comptes de 2 plateformes', count: 2 },
    { label: 'les comptes et taux par défaut', count: 1 },
  ]);

  db.prepare("UPDATE platforms SET commissionAccountNumber = NULL, hasVatOnCommission = 0 WHERE name = 'Booking.com'").run();
  createAccountSettings(db).write({ vatRateCommission: '20' });
  assert.deepEqual(list().data, [{ label: 'les comptes d’une plateforme', count: 1 }]);
  db.close();
});

test('specs/plugins-phase-2-hosts.md rules 20 + 22 — the plugin writes the platform columns it owns; the purge resets the settings and those columns, keeps the money, and the journal is identical after a reinstall', async () => {
  const db = freshDb();
  bankCompensation(db);
  const before = boot(db, { installed: true });
  const journal = async (app) => (await request(app, 'GET', '/api/accounting/sales?month=9&year=2026')).body;
  const reference = await journal(before.app);
  assert.equal(reference.totals.entriesCount, 2, 'the deposit and the indemnity');

  // Customise everything the erasure covers, the old app_settings columns included.
  await request(before.app, 'PUT', '/api/accounting/platform-accounts', {
    defaultAccount: '62260001', cancellationCompensationAccount: '75880100', vatRateCommission: 19.6,
    vatRateCancellationCompensation: 5.5,
    platforms: [{ id: db.prepare("SELECT id FROM platforms WHERE name = 'Airbnb'").get().id, account: '62260300', hasVat: true }],
  });
  db.prepare("UPDATE app_settings SET defaultCommissionAccountNumber = '62260001', cancellationCompensationAccount = '75880100' WHERE id = 1").run();
  assert.notDeepEqual(await journal(before.app), reference, 'the custom produit account shows in the journal');
  const counts = () => ['reservations', 'cancellation_compensations', 'reservation_refunds', 'platforms']
    .map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  const countsBefore = counts();

  const controller = createController(before.plugins, {
    registry, db: () => db, settingsModel: () => buildPluginSettingsModel(db), loader: () => ({ ...loader, runInstallHooks: async () => {} }),
  });
  const res = fakeRes();
  controller.uninstall({ params: { id: ID }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plugin_settings WHERE plugin_id = ?').get(ID).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platforms WHERE commissionAccountNumber IS NOT NULL OR hasVatOnCommission = 1').get().n, 0);
  assert.deepEqual(counts(), countsBefore, 'every stay, compensation, refund and platform row is kept');

  await controller.install({ params: { id: ID } }, fakeRes());
  assert.deepEqual(createAccountSettings(db).read(), {
    defaultCommissionAccountNumber: '622600', vatRateCommission: 20,
    cancellationCompensationAccount: '75880000', vatRateCancellationCompensation: 0,
  }, 'the reinstall does not bring the erased values back from app_settings');
  const after = boot(db, { installed: true });
  assert.deepEqual(await journal(after.app), reference);
  db.close();
});

test('specs/plugins-phase-2-hosts.md rule 22 — phase 0 rule 8 still refuses the uninstall while an accountant-only account exists', () => {
  const db = freshDb();
  const { plugins } = boot(db, { installed: true });
  db.prepare("INSERT INTO users (id, email, passwordHash) VALUES (1, 'compta@example.com', 'x')").run();
  db.prepare("INSERT INTO user_roles (userId, role) VALUES (1, 'accountant')").run();
  const res = fakeRes();
  createController(plugins, { registry, db: () => db }).uninstall({ params: { id: ID }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ACCOUNTANT_USERS');
  assert.ok(plugins.get(ID));
  db.close();
});
