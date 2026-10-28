// specs/plugin-removal-resilience.md rules 1, 2, 6 — a plugin that is gone from the code leaves the
// core booting, never live, and never re-offers the payment link it carried.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { CATALOG_ORDER, readCatalogue } = require('../constants/plugins');
const { readSourceManifest } = require('../plugins/manifest');
const loader = require('../plugins/loader');
const host = require('../plugins/host');
const registry = require('../plugins/sdk/registry');
const pluginsModel = require('../models/pluginsModel');
const { ensurePluginsTable } = require('../utils/pluginsSchema');
const { createController } = require('../controllers/pluginsController');
const { buildController } = require('../controllers/emailsController');
const { buildModel: buildTemplatesModel } = require('../models/emailTemplatesModel');
const { buildModel: buildLogModel } = require('../models/emailLogModel');

const GONE = 'weather-alerts';

function missingOne(id) {
  return (wanted) => {
    if (wanted === id) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return readSourceManifest(wanted);
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function pluginsDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER, role TEXT, PRIMARY KEY (userId, role));
  `);
  ensurePluginsTable(db);
  return db;
}

test('rule 1: the catalogue skips a plugin whose manifest is missing and says so once', () => {
  const logs = [];
  const catalogue = readCatalogue(missingOne(GONE), (line) => logs.push(line));
  assert.equal(catalogue.length, CATALOG_ORDER.length - 1);
  assert.ok(!catalogue.some((p) => p.id === GONE));
  assert.deepEqual(logs, [`[plugins] ${GONE}: manifest introuvable, plugin ignoré`]);
});

test('rule 1: an invalid manifest is skipped like a missing one, never a boot failure', () => {
  const logs = [];
  const invalid = (id) => { if (id === GONE) throw new Error('INVALID_MANIFEST:Nom manquant.'); return readSourceManifest(id); };
  assert.equal(readCatalogue(invalid, (line) => logs.push(line)).length, CATALOG_ORDER.length - 1);
  assert.equal(logs.length, 1);
});

test('rule 1: the shipped catalogue is complete when every folder is there', () => {
  const logs = [];
  assert.equal(readCatalogue(readSourceManifest, (line) => logs.push(line)).length, CATALOG_ORDER.length);
  assert.deepEqual(logs, []);
});

test('rule 1: the packages boot loads the installed rows outside the catalogue, reported PACKAGE_MISSING', () => {
  const env = { ...process.env };
  process.env.GUESTFLOW_PLUGINS = 'packages';
  process.env.GUESTFLOW_PLUGINS_DIST = '/nonexistent-dist';
  try {
    const db = pluginsDb();
    const model = pluginsModel.buildModel(db);
    model.install('linen');
    model.install(GONE, { source: 'bundled', manifest: { id: GONE, name: 'Vigilance Météo-France' } });
    const calls = [];
    const fakeLoader = {
      loadPackages(args) {
        calls.push(args.order);
        return loader.loadPackages({ ...args, store: { packageDirFor: () => null } });
      },
      registerAll() {},
    };
    host.boot({ db, loader: fakeLoader, registry, model, catalogue: [{ id: 'linen', name: 'Linge' }] });
    assert.deepEqual(calls[0], ['linen', GONE]);
    assert.deepEqual(host.state().incompatible[GONE], { code: 'PACKAGE_MISSING', message: 'Paquet introuvable : à réinstaller.' });
  } finally {
    process.env.GUESTFLOW_PLUGINS = env.GUESTFLOW_PLUGINS;
    if (env.GUESTFLOW_PLUGINS === undefined) delete process.env.GUESTFLOW_PLUGINS;
    if (env.GUESTFLOW_PLUGINS_DIST === undefined) delete process.env.GUESTFLOW_PLUGINS_DIST; else process.env.GUESTFLOW_PLUGINS_DIST = env.GUESTFLOW_PLUGINS_DIST;
    host.init({ env: { ...process.env, GUESTFLOW_PLUGINS: 'sources' } });
  }
});

test('rule 1: the sources boot reports an installed row without a module the same way', () => {
  const db = pluginsDb();
  const model = pluginsModel.buildModel(db);
  model.install(GONE, { source: 'bundled', manifest: { id: GONE, name: 'Vigilance Météo-France' } });
  const savedMode = process.env.GUESTFLOW_PLUGINS;
  process.env.GUESTFLOW_PLUGINS = 'sources';
  registry.reset();
  try {
    host.boot({ db, loader: { registerAll() {} }, registry, model, catalogue: [] });
    assert.equal(host.state().incompatible[GONE].code, 'PACKAGE_MISSING');
  } finally {
    if (savedMode === undefined) delete process.env.GUESTFLOW_PLUGINS; else process.env.GUESTFLOW_PLUGINS = savedMode;
    registry.reset();
  }
});

test('rule 1: the Plugins list shows an installed orphan under its stored name, and it can be uninstalled', () => {
  const db = pluginsDb();
  const model = pluginsModel.buildModel(db);
  model.install(GONE, { source: 'bundled', manifest: { id: GONE, name: 'Vigilance Météo-France', icon: 'thunderstorm', surfaces: ['Intégrations'], requires: [] } });
  host.setIncompatible({ [GONE]: { code: 'PACKAGE_MISSING', message: 'Paquet introuvable : à réinstaller.' } });
  const ctrl = createController(model, { db: () => db, registry: { get: () => null, isLive: () => false }, operatorManaged: () => false });
  const listed = fakeRes();
  ctrl.list({}, listed);
  const orphan = listed.body.find((p) => p.id === GONE);
  assert.equal(orphan.name, 'Vigilance Météo-France');
  assert.equal(orphan.state, 'incompatible');
  assert.equal(orphan.incompatible.code, 'PACKAGE_MISSING');
  const removed = fakeRes();
  ctrl.uninstall({ params: { id: GONE }, query: {} }, removed);
  assert.equal(removed.statusCode, 200);
  assert.equal(model.get(GONE), null);
  host.setIncompatible({});
});

test('rule 2: a plugin with no record is never live, in any mode', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  assert.equal(registry.isLive('linen'), false);
  registry.ensure('linen');
  assert.equal(registry.isLive('linen'), true);
  registry.reset();
});

test('rule 2: /api/auth/me never lists an active row whose module is not loaded', () => {
  const db = pluginsDb();
  const model = pluginsModel.buildModel(db);
  model.install('linen');
  model.install(GONE);
  registry.reset();
  registry.configure({ allows: () => true, isActive: (id) => model.isActive(id) });
  registry.ensure('linen');
  // The expression authController's `activePlugins` evaluates.
  assert.deepEqual(model.listActiveIds().filter((id) => registry.isLive(id)), ['linen']);
  registry.reset();
});

function emailsFixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE email_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, dayOffset INTEGER NOT NULL, sendMode TEXT NOT NULL DEFAULT 'manual', enabled INTEGER NOT NULL DEFAULT 1, anchor TEXT NOT NULL DEFAULT 'start', createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, templateId INTEGER, reservationId INTEGER NOT NULL, sentAt TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'smtp', errorMessage TEXT DEFAULT '', renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL, recipientEmail TEXT NOT NULL DEFAULT '', occurrenceKey TEXT NOT NULL DEFAULT '');
    CREATE TABLE reservation_installments (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, number INTEGER NOT NULL, dueDate TEXT NOT NULL, amountCents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, paidDate TEXT, paidMethod TEXT, requestedAt TEXT, dateEdited INTEGER NOT NULL DEFAULT 0, amountEdited INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE reservations (installmentsTarget REAL NOT NULL DEFAULT 0, installmentsPaidAmount REAL NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation', platform TEXT, clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, checkInTime TEXT, checkOutTime TEXT, adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0, singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, finalPrice REAL, depositAmount REAL, depositDueDate TEXT, balanceAmount REAL, balanceDueDate TEXT, cautionAmount REAL, depositPaid INTEGER, balancePaid INTEGER, validUntil TEXT, devisStatus TEXT, convertedReservationId INTEGER);
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT, phone TEXT, streetNumber TEXT, street TEXT, postalCode TEXT, city TEXT, updatedAt TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT);
    CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER);
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, titleEn TEXT, autoOptionType TEXT, displayToClient INTEGER DEFAULT 1);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER);
    CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, nameEn TEXT);
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE reservation_custom_options (reservationId INTEGER, description TEXT, amount REAL, inComplement INTEGER DEFAULT 0, offered INTEGER DEFAULT 0, sortOrder INTEGER);
  `);
  db.prepare("INSERT INTO email_templates (id, stableKey, name, subject, body, dayOffset, sendMode, enabled, anchor) VALUES (20, 'deposit_reminder', 'Relance', 'Devis', '{{#if hasPaymentLink}}Lien : {{paymentLink}}{{else}}Aucun lien{{/if}}', -3, 'manual', 1, 'validUntil')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@dupont.fr')").run();
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, validUntil, devisStatus) VALUES (300, 'devis', 1, 1, '2026-08-10', '2026-08-12', '2026-07-04', 'sent')").run();
  const settingsModel = {
    read: () => ({ companyName: 'Demo', smtpHost: 'smtp.x', smtpFromEmail: 'from@x' }),
    smtpConfigured: () => true,
    decryptedSmtpSettings: () => ({}),
  };
  const paymentLinksModel = { findOpenForReservation: () => ({ url: 'https://pay.example/pl_X' }) };
  return buildController({
    database: db,
    templatesModel: buildTemplatesModel(db),
    logModel: buildLogModel(db),
    settingsModel,
    paymentLinksModel,
    emailServiceFactory: () => ({ isConfigured: true, send: async () => ({}), sendTest: async () => ({}) }),
  });
}

function previewBody(ctl) {
  const r = fakeRes();
  ctl.preview({ query: { reservationId: 300, templateId: 20 } }, r);
  return r.body.body;
}

test('rule 6: a stored open link is not re-offered while no payment provider is live', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  assert.equal(previewBody(emailsFixture()), 'Aucun lien');
  registry.reset();
});

test('rule 6: the same link is offered again once a provider is live', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  registry.ensure('online-payment').paymentProvider = { id: 'fixture', isReady: () => false };
  assert.equal(previewBody(emailsFixture()), 'Lien : https://pay.example/pl_X');
  registry.reset();
});
