// specs/booking-extranet-intake.md rule 1 — the plugin is catalogued from its manifest, is not installed on a
// fresh database, keeps the state a v3.10.0 database gave it, registers its tables, routes and settings, and
// leaves a base installation untouched until it is switched on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const registry = require('../../sdk/registry');
const loader = require('../../loader');
const bookingIntake = require('..');
const { PLUGIN_IDS, findPlugin } = require('../../../constants/plugins');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { ensurePluginsTable, ensurePluginSettingsTable, seedBuiltinPlugins } = require('../../../utils/pluginsSchema');
const { validateManifest } = require('../../manifest');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  return db;
}

test('specs/booking-extranet-intake.md rule 1: the plugin is in the catalogue, from its own manifest', () => {
  const entry = findPlugin('booking-intake');
  assert.ok(entry);
  assert.ok(PLUGIN_IDS.includes('booking-intake'));
  assert.equal(entry.name, 'Saisie Booking');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.deepEqual(validateManifest(manifest), []);
  assert.ok(manifest.changelog[manifest.version].length > 0, 'French lines for the shipped version');
});

test('specs/booking-extranet-intake.md rule 1: a fresh database installs nothing — the plugin waits on the Plugins page', () => {
  const db = freshDb();
  seedBuiltinPlugins(db);
  assert.equal(buildPluginsModel(db).get('booking-intake'), null);
});

test('specs/booking-extranet-intake.md rule 1: a database that ran the minimal engine of v3.10.0 keeps its two intake choices, and gets the other plugins active', () => {
  const db = freshDb();
  db.prepare("INSERT INTO properties (name) VALUES ('La Granja')").run();
  // What master v3.10.0 left: its own seed ledgers, the two intake rows, `builtin` source.
  db.prepare("INSERT INTO plugins (id, enabled, source) VALUES ('gites-de-france-intake', 1, 'builtin'), ('booking-intake', 0, 'builtin')").run();
  db.prepare("INSERT INTO migrations (name) VALUES ('plugins_backport_seed_v1'), ('plugins_backport_seed_v2')").run();

  ensurePluginsTable(db);
  seedBuiltinPlugins(db);
  const plugins = buildPluginsModel(db);
  assert.equal(plugins.get('gites-de-france-intake').enabled, true, 'the activated plugin stays activated');
  assert.equal(plugins.get('booking-intake').enabled, false, 'the inactive one stays inactive');
  assert.equal(plugins.get('sas').enabled, true, 'Solio sees no difference: the moved-out features stay on');
  assert.deepEqual(db.prepare("SELECT DISTINCT source FROM plugins").all().map((r) => r.source), ['bundled']);

  seedBuiltinPlugins(db);
  assert.equal(plugins.get('booking-intake').enabled, false, 'a later boot changes nothing');
});

function boot(db, { installed = true } = {}) {
  registry.reset();
  const plugins = buildPluginsModel(db);
  if (installed) plugins.install('booking-intake');
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [bookingIntake], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  return { plugins, settingsModel, record: registry.get('booking-intake') };
}

test('specs/booking-extranet-intake.md rule 1: registered, it declares both mounts, its settings and its tables — and a base installation has none of them', () => {
  const base = freshDb();
  boot(base, { installed: false });
  assert.equal(base.prepare("SELECT 1 FROM sqlite_master WHERE name = 'booking_intakes'").get(), undefined);

  const db = freshDb();
  const { record } = boot(db);
  assert.deepEqual(record.mounts.map((m) => [m.path, Boolean(m.public)]).sort(), [['/api/booking-intake', false], ['/public/booking-intake', true]]);
  assert.deepEqual(record.settings.map((s) => [s.key, Boolean(s.secret)]), [['hotelIds', false], ['sourceKeys', false], ['key', true]]);
  assert.deepEqual(record.data.tables, ['booking_intakes', 'booking_dismissals']);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'booking_intakes'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'booking_dismissals'").get());
});

test('specs/booking-extranet-intake.md rule 1: not live until activated, and the public door is a public mount outside /api', () => {
  const db = freshDb();
  const { plugins, record } = boot(db);
  plugins.setEnabled('booking-intake', false);
  assert.equal(registry.isLive('booking-intake'), false);
  plugins.setEnabled('booking-intake', true);
  assert.equal(registry.isLive('booking-intake'), true);
  assert.ok(record.mounts.filter((m) => m.public).every((m) => m.path.startsWith('/public/')));
});

test('specs/booking-extranet-intake.md rule 12: the settings refuse a hotel map or source list that is not what the plugin reads', () => {
  const { record } = boot(freshDb());
  const check = (key, value) => record.settings.find((s) => s.key === key).validate(value);
  assert.equal(check('hotelIds', '{"1":"14407976"}'), null);
  assert.match(check('hotelIds', '{"1":"abc"}'), /chiffres/);
  assert.match(check('hotelIds', '[1]'), /chiffres/);
  assert.match(check('hotelIds', 'nope'), /chiffres/);
  assert.equal(check('sourceKeys', '["booking","lodgify"]'), null);
  assert.match(check('sourceKeys', '"booking"'), /illisible/);
  assert.match(check('sourceKeys', '[1]'), /illisible/);
});

test('specs/booking-extranet-intake.md rule 2: the secret is stored encrypted and the HTTP view only says whether it is set', () => {
  const db = freshDb();
  const { settingsModel, record } = boot(db);
  assert.deepEqual(settingsModel.httpView('booking-intake', record.settings), { hotelIds: '{}', sourceKeys: '["booking","lodgify"]', keySet: false });
  settingsModel.set('booking-intake', 'key', 'plain-secret', { secret: true });
  const view = settingsModel.httpView('booking-intake', record.settings);
  assert.equal(view.keySet, true);
  assert.doesNotMatch(JSON.stringify(view), /plain-secret/);
  assert.doesNotMatch(settingsModel.raw('booking-intake', 'key'), /plain-secret/);
  assert.equal(settingsModel.get('booking-intake', 'key', { secret: true }), 'plain-secret');
});
