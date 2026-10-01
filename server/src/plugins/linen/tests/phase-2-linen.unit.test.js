// specs/plugins-phase-2-hosts.md §3.B, §3.D, §3.G — linen & laundry as a plugin module: its planning
// endpoints and the shortage alert behind the plugin, the bed-linen alert computed only while it is
// live, its erasure, and its settings copied from app_settings once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const express = require('express');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const SRC = path.join(__dirname, '..', '..', '..');
const registry = require('../../sdk/registry');
const loader = require('../../loader');
const linenModule = require('..');
const { applyPluginSchema } = require('../../sdk/testing');
const { SETTINGS_COPY_MARKER } = require('../migrations');
const { buildModel: buildPluginSettingsModel } = require(path.join(SRC, 'models/pluginSettingsModel'));
const { buildModel: buildPluginsModel } = require(path.join(SRC, 'models/pluginsModel'));
const { createController } = require(path.join(SRC, 'controllers/pluginsController'));
const { ensurePluginsTable, ensurePluginSettingsTable } = require(path.join(SRC, 'utils/pluginsSchema'));

const SCHEMA = fs.readFileSync(path.join(SRC, 'schema.sql'), 'utf8');
const LAUNDRY_TABLES = ['laundry_trip_skips', 'laundry_trip_manual_additions', 'laundry_extra_trips'];
const SETTING_KEYS = [
  'laundryWeekday', 'bedLinenStockSingle', 'bedLinenStockDouble', 'bedLinenStockBaby',
  'towelStockLarge', 'towelStockMedium', 'towelStockSmall', 'towelStockBathMat',
];

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec('INSERT INTO app_settings (id) VALUES (1)');
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  return db;
}

const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

function boot(db, { installed = [] } = {}) {
  registry.reset();
  const plugins = buildPluginsModel(db);
  installed.forEach((id) => plugins.install(id));
  registry.configure({ isActive: (id) => plugins.isActive(id), allows: () => true });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [linenModule], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const app = express();
  app.use(express.json());
  app.use('/api/planning', require(path.join(SRC, 'routes/planning')));
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
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.afterEach(() => registry.reset());

test('specs/plugins-phase-2-hosts.md rule 4: the two laundry planning endpoints answer 404 while linen is off; breakfast and option cards stay core', async () => {
  const db = freshDb();
  const { app, plugins } = boot(db, { installed: [] });
  for (const url of ['/api/planning/laundry?from=2026-10-01&to=2026-10-14', '/api/planning/linen-inventory']) {
    const res = await request(app, 'GET', url);
    assert.equal(res.status, 404, url);
    assert.deepEqual(res.body, { error: 'PLUGIN_INACTIVE', plugin: 'linen' });
  }
  // The core planning router still answers its own endpoints (a bad range is its own 400).
  assert.deepEqual((await request(app, 'GET', '/api/planning/breakfast?from=x&to=y')).body, { error: 'INVALID_DATE_RANGE' });
  assert.deepEqual((await request(app, 'GET', '/api/planning/option-cards?from=x&to=y')).body, { error: 'INVALID_DATE_RANGE' });

  plugins.install('linen');
  applyPluginSchema(db, 'linen');
  const laundry = await request(app, 'GET', '/api/planning/laundry?from=2026-10-01&to=2026-10-14');
  assert.equal(laundry.status, 200);
  assert.equal(laundry.body.laundryWeekday, 2);
  assert.equal(laundry.body.laundryDays.length, 2);
  assert.deepEqual((await request(app, 'GET', '/api/planning/linen-inventory')).body, { horizon: null, byLaundryDay: {} });
  assert.equal((await request(app, 'GET', '/api/laundry/skips')).status, 200);

  const src = fs.readFileSync(path.join(SRC, 'routes/planning.js'), 'utf8');
  assert.doesNotMatch(src, /router\.\w+\('\/(laundry|linen)/);
});

test('specs/plugins-phase-2-hosts.md rule 15: /api/laundry and the shortage alert (gap 1) answer 404 while linen is off', async () => {
  const db = freshDb();
  const { app, plugins } = boot(db, { installed: ['linen'] });
  plugins.setEnabled('linen', false);
  for (const url of ['/api/laundry/skips', '/api/laundry/extra-trips', '/api/dashboard/linen-shortage']) {
    const res = await request(app, 'GET', url);
    assert.equal(res.status, 404, url);
    assert.deepEqual(res.body, { error: 'PLUGIN_INACTIVE', plugin: 'linen' });
  }
  plugins.setEnabled('linen', true);
  assert.deepEqual((await request(app, 'GET', '/api/dashboard/linen-shortage')).body, { horizon: null, shortagesByType: [] });
  assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'routes/dashboard.js'), 'utf8'), /linen/);
  assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'index.js'), 'utf8'), /\/api\/laundry/);
});

test('specs/plugins-phase-2-hosts.md rule 15: the stock and the laundry day are read and written through /api/plugins/linen/settings, validated', () => {
  const db = freshDb();
  const { plugins, settingsModel } = boot(db, { installed: ['linen'] });
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel });
  let res = fakeRes();
  controller.getSettings({ params: { id: 'linen' } }, res);
  assert.deepEqual(Object.keys(res.body).sort(), [...SETTING_KEYS].sort());

  res = fakeRes();
  controller.saveSettings({ params: { id: 'linen' }, body: { bedLinenStockDouble: 1200, laundryWeekday: 9 } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_SETTING');
  assert.deepEqual(Object.keys(res.body.errors).sort(), ['bedLinenStockDouble', 'laundryWeekday']);
  assert.equal(settingsModel.raw('linen', 'bedLinenStockDouble'), '0', 'the refused write left the copied value');

  res = fakeRes();
  controller.saveSettings({ params: { id: 'linen' }, body: { bedLinenStockDouble: 12, laundryWeekday: 4 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.bedLinenStockDouble, '12');
  assert.equal(res.body.laundryWeekday, '4');
});

test('specs/plugins-phase-2-hosts.md rule 17: the bed-linen alert is computed only while linen is live', () => {
  const db = freshDb();
  const plugins = buildPluginsModel(db);
  registry.reset();
  registry.configure({ isActive: (id) => plugins.isActive(id), allows: () => true });
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Ana', 'Lopez')").run();
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, adults, kind)
    VALUES (1, 1, 1, '2026-10-10', '2026-10-12', 2, 'reservation')`).run();
  const reservations = require(path.join(SRC, 'models/reservationsModel')).create(db);

  assert.equal('bedLinenAlert' in reservations.getByIdWithDetails(1), false);
  plugins.install('linen');
  assert.deepEqual(reservations.getByIdWithDetails(1).bedLinenAlert, { type: 'no_linen' });
  plugins.setEnabled('linen', false);
  assert.equal('bedLinenAlert' in reservations.getByIdWithDetails(1), false);
});

test('specs/plugins-phase-2-hosts.md rule 18: describe() lists what an erasure takes and leaves out the zero counts', () => {
  const db = freshDb();
  const { plugins, settingsModel } = boot(db, { installed: ['linen'] });
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel });
  // A new database: the copy wrote the column defaults, so only the settings line shows.
  let res = fakeRes();
  controller.list({}, res);
  let linen = res.body.find((p) => p.id === 'linen');
  assert.equal(linen.erasable, true);
  assert.deepEqual(linen.data.map((l) => l.label), ['le stock et le jour de blanchisserie']);

  ['2026-10-06', '2026-10-13', '2026-10-20'].forEach((d) => db.prepare('INSERT INTO laundry_trip_skips (tripDate) VALUES (?)').run(d));
  db.prepare("INSERT INTO laundry_trip_manual_additions (tripDate, singleBeds) VALUES ('2026-10-06', 1), ('2026-10-13', 2)").run();
  db.prepare("INSERT INTO laundry_extra_trips (tripDate) VALUES ('2026-10-09')").run();
  res = fakeRes();
  controller.list({}, res);
  linen = res.body.find((p) => p.id === 'linen');
  assert.deepEqual(linen.data.map((l) => l.label), [
    '3 tournées sautées', '2 ajouts manuels', '1 tournée supplémentaire', 'le stock et le jour de blanchisserie',
  ]);

  db.prepare('DELETE FROM laundry_trip_manual_additions').run();
  SETTING_KEYS.forEach((key) => settingsModel.set('linen', key, ''));
  res = fakeRes();
  controller.list({}, res);
  linen = res.body.find((p) => p.id === 'linen');
  assert.deepEqual(linen.data.map((l) => l.label), ['3 tournées sautées', '1 tournée supplémentaire']);
});

test('specs/plugins-phase-2-hosts.md rule 18: the purge empties the three tables and the eight settings, and keeps the options and the beds', async () => {
  const db = freshDb();
  const { plugins, settingsModel } = boot(db, { installed: ['linen'] });
  db.prepare("INSERT INTO options (id, title, countsAsBedLinen) VALUES (7, 'Linge de lit', 1)").run();
  db.prepare("INSERT INTO laundry_trip_skips (tripDate) VALUES ('2026-10-06')").run();
  db.prepare("INSERT INTO laundry_trip_manual_additions (tripDate, singleBeds) VALUES ('2026-10-06', 1)").run();
  db.prepare("INSERT INTO laundry_extra_trips (tripDate) VALUES ('2026-10-09')").run();
  db.prepare('UPDATE app_settings SET bedLinenStockDouble = 14 WHERE id = 1').run();
  settingsModel.set('linen', 'bedLinenStockDouble', '14');
  settingsModel.set('linen', 'laundryWeekday', '4');

  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, loader: () => loader });
  const res = fakeRes();
  controller.uninstall({ params: { id: 'linen' }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 200);
  LAUNDRY_TABLES.forEach((t) => assert.equal(tableExists(db, t), false, t));
  SETTING_KEYS.forEach((key) => assert.equal(settingsModel.raw('linen', key), '', key));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options WHERE id = 7').get().n, 1);

  // Reinstalled: empty tables, and the stock reads 0 — the frozen column is not copied back.
  await controller.install({ params: { id: 'linen' } }, fakeRes());
  LAUNDRY_TABLES.forEach((t) => assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t));
  const view = fakeRes();
  controller.getSettings({ params: { id: 'linen' } }, view);
  assert.equal(view.body.bedLinenStockDouble, '0');
  assert.equal(view.body.laundryWeekday, '2');
});

test('specs/plugins-phase-2-hosts.md rule 28: the eight settings are copied from app_settings once, byte for byte, empty values skipped', () => {
  const db = freshDb();
  db.prepare(`UPDATE app_settings SET laundryWeekday = 4, bedLinenStockSingle = 6, bedLinenStockDouble = 14,
    bedLinenStockBaby = 0, towelStockLarge = 20, towelStockMedium = 10, towelStockSmall = 12, towelStockBathMat = 3 WHERE id = 1`).run();
  const settingsModel = buildPluginSettingsModel(db);
  settingsModel.set('linen', 'towelStockSmall', '99');

  applyPluginSchema(db, 'linen');
  const stored = Object.fromEntries(db.prepare("SELECT key, value FROM plugin_settings WHERE plugin_id = 'linen'").all().map((r) => [r.key, r.value]));
  assert.deepEqual(stored, {
    laundryWeekday: '4', bedLinenStockSingle: '6', bedLinenStockDouble: '14', bedLinenStockBaby: '0',
    towelStockLarge: '20', towelStockMedium: '10', towelStockSmall: '99', towelStockBathMat: '3',
  });
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SETTINGS_COPY_MARKER));
  // The old columns stay in place, unread.
  assert.equal(db.prepare('SELECT bedLinenStockDouble FROM app_settings WHERE id = 1').get().bedLinenStockDouble, 14);

  // Once: a second run (after the ledger of the plugin is forgotten) copies nothing.
  db.prepare("DELETE FROM migrations WHERE name LIKE 'plugin:linen:%'").run();
  db.prepare("DELETE FROM plugin_settings WHERE plugin_id = 'linen'").run();
  applyPluginSchema(db, 'linen');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM plugin_settings WHERE plugin_id = 'linen'").get().n, 0);

  // Empty values are skipped (an empty string or NULL in a column that lost its NOT NULL elsewhere).
  const legacy = new Database(':memory:');
  legacy.exec("CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  legacy.exec('CREATE TABLE app_settings (id INTEGER PRIMARY KEY, laundryWeekday TEXT, bedLinenStockSingle TEXT)');
  legacy.prepare("INSERT INTO app_settings (id, laundryWeekday, bedLinenStockSingle) VALUES (1, '', NULL)").run();
  ensurePluginSettingsTable(legacy);
  applyPluginSchema(legacy, 'linen');
  assert.equal(legacy.prepare("SELECT COUNT(*) AS n FROM plugin_settings WHERE plugin_id = 'linen'").get().n, 0);
});

test('specs/plugins-phase-2-hosts.md rule 29: a new database has no laundry table before linen is installed', () => {
  const db = freshDb();
  LAUNDRY_TABLES.forEach((t) => assert.equal(tableExists(db, t), false, t));
  const baseline = fs.readFileSync(path.join(SRC, 'database.js'), 'utf8');
  LAUNDRY_TABLES.forEach((t) => {
    assert.doesNotMatch(SCHEMA, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`), t);
    assert.doesNotMatch(baseline, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`), t);
  });
  applyPluginSchema(db, 'linen');
  LAUNDRY_TABLES.forEach((t) => assert.equal(tableExists(db, t), true, t));
  // An existing database (Solio): the tables are already there, the migration only records itself.
  assert.equal(applyPluginSchema(db, 'linen'), 0);
});

test('specs/plugins-phase-2-hosts.md rule 16: what is sold and booked stays core, and the erasure leaves it', async () => {
  for (const table of ['options', 'property_option_bath_mats', 'linen_priced_items', 'reservations']) {
    assert.match(SCHEMA, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`), table);
  }
  const db = freshDb();
  const { plugins, settingsModel } = boot(db, { installed: ['linen'] });
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO options (id, title, countsAsBedLinen, countsAsBathMat) VALUES (7, 'Linge de lit', 1, 0), (8, 'Tapis de bain', 0, 1)").run();
  db.prepare('INSERT INTO property_option_bath_mats (propertyId, optionId, quantity) VALUES (1, 8, 2)').run();
  db.prepare("INSERT INTO linen_priced_items (label, price) VALUES ('Drap', 15)").run();
  createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, loader: () => loader })
    .uninstall({ params: { id: 'linen' }, query: { purge: '1' } }, fakeRes());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options WHERE countsAsBedLinen = 1 OR countsAsBathMat = 1').get().n, 2);
  assert.equal(db.prepare('SELECT quantity FROM property_option_bath_mats').get().quantity, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM linen_priced_items').get().n, 1);
});
