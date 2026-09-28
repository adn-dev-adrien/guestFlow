// specs/plugins-phase-1-sdk.md — the plugin SDK: modules register their routes, tables, settings,
// jobs, event handlers, email variables and SAS data; the core only asks the registry. Covers the
// loader, isolation, migrations, settings, jobs, events, email variables, erasure and the gate paths
// that used to run while the plugin was off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const express = require('express');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const registry = require('../plugins/sdk/registry');
const loader = require('../plugins/loader');
const eventBus = require('../plugins/sdk/eventBus');
const MODULES = require('../plugins');
const { buildModel: buildPluginSettingsModel } = require('../models/pluginSettingsModel');
const { buildModel: buildPluginsModel } = require('../models/pluginsModel');
const { createController } = require('../controllers/pluginsController');
const {
  ensurePluginsTable, ensurePluginSettingsTable, copyAppSettingsToPlugins, SETTINGS_COPY_MIGRATION,
} = require('../utils/pluginsSchema');
const { isEncrypted } = require('../utils/encryption');

const SRC = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(SRC, 'schema.sql'), 'utf8');
const MODULE_IDS = ['weather-alerts', 'school-holidays', 'google-calendar', 'tariff-recipes', 'gate-access'];

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  return db;
}

const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

// Boots the modules on `db`: `installed` and `active` are the plugins rows, `modules` defaults to the five.
function boot(db, { installed = [], active = installed, modules = MODULES } = {}) {
  registry.reset();
  const plugins = buildPluginsModel(db);
  installed.forEach((id) => {
    plugins.install(id);
    if (!active.includes(id)) plugins.setEnabled(id, false);
  });
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules, settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const app = express();
  app.use(express.json());
  loader.mountPublic(app);
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

// ---------- §3.A the modules (rules 1-4) ----------

test('rule 1-2: the five plugin modules are listed once, each with an id and a register function', () => {
  assert.deepEqual(MODULES.map((m) => m.id).sort(), [...MODULE_IDS].sort());
  MODULES.forEach((m) => assert.equal(typeof m.register, 'function', m.id));
});

// Rule 3 — a plugin file imports its own folder, the SDK or npm; the core never imports a plugin
// folder except through the module list. Tests are exempt: they reach into both on purpose.
function importViolations(files) {
  const out = [];
  for (const [file, source] of Object.entries(files)) {
    const rel = file.split(path.sep).join('/');
    if (/\/tests\//.test(`/${rel}`)) continue;
    const inPlugin = rel.match(/^plugins\/([^/]+)\//);
    for (const m of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (inPlugin && inPlugin[1] !== 'sdk') {
        const own = target.startsWith(`plugins/${inPlugin[1]}/`) || target === `plugins/${inPlugin[1]}`;
        if (!own && !target.startsWith('plugins/sdk')) out.push(`${rel} → ${spec}`);
      } else if (!inPlugin) {
        // The host side — the SDK, the loader and the module list — is the core's door to plugins.
        const pluginTarget = target.match(/^plugins\/([^/.]+)/);
        const host = !pluginTarget || ['sdk', 'loader', 'index'].includes(pluginTarget[1]);
        if (!host && rel !== 'plugins/index.js') out.push(`${rel} → ${spec}`);
      }
    }
  }
  return out;
}

function readTree(dir, base = dir, acc = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') readTree(full, base, acc); continue; }
    if (e.name.endsWith('.js')) acc[path.relative(base, full)] = fs.readFileSync(full, 'utf8');
  }
  return acc;
}

test('rule 3: no plugin imports the core outside the SDK, and the core imports no plugin folder', () => {
  assert.deepEqual(importViolations(readTree(SRC)), []);
});

test('rule 3: the isolation walk does catch a planted violation in either direction', () => {
  assert.deepEqual(importViolations({
    'plugins/weather-alerts/x.js': "require('../../models/settingsModel')",
    'controllers/y.js': "require('../plugins/google-calendar/sync')",
    'plugins/gate-access/z.js': "require('../sdk'); require('./keys'); require('qrcode')",
  }), [
    'plugins/weather-alerts/x.js → ../../models/settingsModel',
    'controllers/y.js → ../plugins/google-calendar/sync',
  ]);
});

test('rule 4: a module that throws in register is failed, answers 404, and the others still mount', async () => {
  const db = freshDb();
  const broken = { id: 'weather-alerts', register() { throw new Error('boom'); } };
  const holidays = MODULES.find((m) => m.id === 'school-holidays');
  const { app, plugins } = boot(db, { installed: ['weather-alerts', 'school-holidays'], modules: [broken, holidays] });
  assert.equal(registry.get('weather-alerts').failed, 'boom');
  assert.equal(registry.isLive('weather-alerts'), false);
  assert.equal((await request(app, 'GET', '/api/reservations/1/weather-alerts')).status, 404);
  assert.equal((await request(app, 'GET', '/api/school-holidays')).status, 200);
  const view = createController(plugins, { registry }).list;
  const res = fakeRes();
  view({}, res);
  assert.equal(res.body.find((p) => p.id === 'weather-alerts').state, 'failed');
});

// ---------- §3.B routes (rule 5) ----------

test('rule 5: every moved route keeps its URL and answers 404 PLUGIN_INACTIVE while its plugin is off', async () => {
  const db = freshDb();
  const { app } = boot(db, { installed: MODULE_IDS, active: [] });
  for (const url of [
    '/api/reservations/1/weather-alerts', '/api/school-holidays', '/api/google-calendar/status',
    '/api/tariff-recipes', '/api/properties/1/tariff-recipe/preview?recipeId=x',
    '/api/reservations/1/gate-access', '/api/dashboard/gate-keys', '/api/settings/gate-connector',
    '/public/v1/gate/ping',
  ]) {
    const { status, body } = await request(app, 'GET', url);
    assert.equal(status, 404, url);
    assert.equal(body.error, 'PLUGIN_INACTIVE', url);
  }
});

test('rule 5: a route under a core prefix does not swallow the core routes beside it', async () => {
  const db = freshDb();
  const { app } = boot(db, { installed: ['weather-alerts'], active: [] });
  app.get('/api/reservations/:id', (req, res) => res.json({ core: true }));
  assert.deepEqual((await request(app, 'GET', '/api/reservations/7')).body, { core: true });
});

test('rule 5: a public mount is refused outside /public/, a plain mount outside /api/', () => {
  registry.reset();
  const { createContext } = require('../plugins/sdk/createContext');
  const ctx = createContext('weather-alerts', { db: null });
  assert.throws(() => ctx.mount('/api/x', express.Router(), { public: true }), /public/);
  assert.throws(() => ctx.mount('/x', express.Router()), /\/api\//);
});

test('rule 5: plugin reception entries join the role guard; inactive, the route still ends in 404', () => {
  const db = freshDb();
  boot(db, { installed: [] });
  const matchers = loader.receptionMatchers().map((m) => `${m.method} ${m.re.source}`);
  assert.ok(matchers.some((m) => m.includes('weather-alerts')));
  assert.ok(matchers.some((m) => m.includes('gate-access')));
});

// ---------- tables (rule 6) ----------

test('rule 6: an uninstalled plugin has no table; installing creates them and records the ledger', async () => {
  const db = freshDb();
  const { plugins } = boot(db, { installed: [] });
  assert.equal(tableExists(db, 'school_holidays'), false);
  assert.equal(tableExists(db, 'gate_key_results'), false);
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => buildPluginSettingsModel(db), loader: () => ({ ...loader, runInstallHooks: async () => {} }) });
  const res = fakeRes();
  await controller.install({ params: { id: 'gate-access' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(tableExists(db, 'gate_key_results'), true);
  assert.ok(db.prepare("SELECT 1 FROM migrations WHERE name = 'plugin:gate-access:tables_v1'").get());
});

test('rule 6: on a database that predates the module the migrations are no-ops, and run once', () => {
  const db = freshDb();
  db.exec('CREATE TABLE weather_vigilance_cache (departmentCode TEXT PRIMARY KEY, payload TEXT NOT NULL, fetchedAt TEXT NOT NULL)');
  db.prepare("INSERT INTO weather_vigilance_cache VALUES ('07', '[]', '2026-09-28')").run();
  boot(db, { installed: ['weather-alerts'] });
  boot(db, { installed: [] });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM weather_vigilance_cache').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM migrations WHERE name LIKE 'plugin:weather-alerts:%'").get().n, 1);
});

test('rule 6: a migration that fails at install time refuses the install and records nothing', async () => {
  const db = freshDb();
  const bad = { id: 'weather-alerts', register(ctx) { ctx.migrations([{ name: 'bad', up: () => { throw new Error('nope'); } }]); } };
  const { plugins } = boot(db, { installed: [], modules: [bad] });
  const controller = createController(plugins, { registry, db: () => db, loader: () => loader });
  const res = fakeRes();
  await controller.install({ params: { id: 'weather-alerts' } }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'PLUGIN_MIGRATION_FAILED', plugin: 'weather-alerts' });
  assert.equal(plugins.get('weather-alerts'), null);
  assert.equal(db.prepare("SELECT 1 FROM migrations WHERE name = 'plugin:weather-alerts:bad'").get(), undefined);
});

// ---------- settings (rule 7) ----------

test('rule 7: a secret is encrypted at rest and only reads back as <key>Set over HTTP', () => {
  const db = freshDb();
  const { settingsModel } = boot(db, { installed: ['weather-alerts'] });
  const controller = createController(buildPluginsModel(db), { registry, settingsModel: () => settingsModel });
  let res = fakeRes();
  controller.saveSettings({ params: { id: 'weather-alerts' }, body: { apiKey: '  secret-key  ' } }, res);
  assert.deepEqual(res.body, { apiKeySet: true });
  assert.ok(isEncrypted(settingsModel.raw('weather-alerts', 'apiKey')));
  assert.equal(settingsModel.get('weather-alerts', 'apiKey', { secret: true }), 'secret-key');

  res = fakeRes();
  controller.saveSettings({ params: { id: 'weather-alerts' }, body: { apiKey: '' } }, res);
  assert.equal(settingsModel.get('weather-alerts', 'apiKey', { secret: true }), 'secret-key', "'' keeps it");
  controller.saveSettings({ params: { id: 'weather-alerts' }, body: { apiKey: null } }, fakeRes());
  assert.equal(settingsModel.raw('weather-alerts', 'apiKey'), '', 'null clears it');

  res = fakeRes();
  controller.saveSettings({ params: { id: 'weather-alerts' }, body: { other: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'UNKNOWN_SETTING', keys: ['other'] });
});

test('rule 7 / §5: the copy migration moves the Météo key and the Google fields byte for byte, once', () => {
  const db = freshDb();
  db.exec("CREATE TABLE IF NOT EXISTS app_settings_probe (x)");
  const cols = new Set(db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name));
  for (const col of ['meteoFranceApiKeyEncrypted', 'googleOAuthRefreshTokenEncrypted', 'googleCalendarId', 'googleOAuthConnectedEmail', 'googleLastSyncOk']) {
    if (!cols.has(col)) db.exec(`ALTER TABLE app_settings ADD COLUMN ${col} TEXT DEFAULT ''`);
  }
  db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();
  db.prepare(`UPDATE app_settings SET meteoFranceApiKeyEncrypted = 'enc:v1:aaa', googleOAuthRefreshTokenEncrypted = 'enc:v1:bbb',
    googleCalendarId = 'enc:v1:ccc', googleOAuthConnectedEmail = 'a@b.fr', googleLastSyncOk = '1' WHERE id = 1`).run();
  assert.equal(copyAppSettingsToPlugins(db), 5);
  const rows = Object.fromEntries(db.prepare("SELECT plugin_id || ':' || key AS k, value FROM plugin_settings").all().map((r) => [r.k, r.value]));
  assert.equal(rows['weather-alerts:apiKey'], 'enc:v1:aaa');
  assert.equal(rows['google-calendar:refreshToken'], 'enc:v1:bbb');
  assert.equal(rows['google-calendar:calendarId'], 'enc:v1:ccc');
  assert.equal(rows['google-calendar:connectedEmail'], 'a@b.fr');
  assert.equal(rows['google-calendar:lastSyncOk'], '1');
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SETTINGS_COPY_MIGRATION));
  db.prepare("UPDATE app_settings SET googleOAuthConnectedEmail = 'changed@b.fr' WHERE id = 1").run();
  assert.equal(copyAppSettingsToPlugins(db), 0);
});

// ---------- jobs (rule 8) ----------

test('rule 8: the jobs keep today’s intervals and boot delays, and skip their tick while inactive', async () => {
  const db = freshDb();
  boot(db, { installed: MODULE_IDS, active: [] });
  const intervals = [];
  const timeouts = [];
  loader.startJobs({ setIntervalFn: (fn, ms) => intervals.push([fn, ms]), setTimeoutFn: (fn, ms) => timeouts.push(ms) });
  const HOUR = 60 * 60 * 1000;
  assert.deepEqual(intervals.map(([, ms]) => ms).sort((a, b) => a - b), [15 * 60 * 1000, HOUR, HOUR, 24 * HOUR]);
  assert.deepEqual(timeouts.sort((a, b) => a - b), [60 * 1000, 130 * 1000, 140 * 1000, 160 * 1000]);
  const ran = [];
  const record = registry.get('school-holidays');
  record.jobs[0].run = () => { ran.push('tick'); };
  await Promise.all(intervals.map(([fn]) => fn()));
  assert.deepEqual(ran, []);
});

test('rule 8: a job that throws is logged with its plugin and name, and the scheduler goes on', async () => {
  const db = freshDb();
  const mod = { id: 'weather-alerts', register(ctx) { ctx.jobs.every({ name: 'boom', intervalMs: 1000, run: () => { throw new Error('x'); } }); } };
  boot(db, { installed: ['weather-alerts'], modules: [mod] });
  const ticks = [];
  loader.startJobs({ setIntervalFn: (fn) => ticks.push(fn), setTimeoutFn: () => {} });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try { await ticks[0](); } finally { console.error = original; }
  assert.match(errors[0], /\[plugin:weather-alerts:boom\] unhandled/);
});

// ---------- events (rule 9) ----------

test('rule 9: the ten former direct calls now emit the right event', () => {
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  const expect = [
    ['controllers/reservationsController.js', "emitPluginEvent('reservation.created'"],
    ['controllers/reservationsController.js', "emitPluginEvent('reservation.updated'"],
    ['controllers/reservationsController.js', "emitPluginEvent('reservation.deleted'"],
    ['controllers/reservationCancellationController.js', "emitPluginEvent('reservation.cancelled'"],
    ['controllers/dashboardController.js', "emitPluginEvent('reservation.updated'"],
    ['controllers/dashboardController.js', "emitPluginEvent('reservation.cancelled'"],
    ['controllers/devisController.js', "emitPluginEvent('reservation.created'"],
    ['utils/paymentPollRunner.js', "emitPluginEvent('reservation.created'"],
    ['models/propertyIcalModel.js', "emitPluginEvent('ical.imported'"],
  ];
  for (const [file, call] of expect) assert.ok(read(file).includes(call), `${file}: ${call}`);
  const core = readTree(SRC);
  const leftovers = Object.keys(core).filter((f) => !f.includes(`plugins${path.sep}`) && !f.includes(`tests${path.sep}`)
    && /googleCalendarSync|schedulePush|scheduleDelete|scheduleReconcile/.test(core[f]));
  assert.deepEqual(leftovers, []);
});

test('rule 9: a handler runs only while its plugin is live, and a throwing one never reaches the others', async () => {
  const db = freshDb();
  const seen = [];
  const a = { id: 'weather-alerts', register(ctx) { ctx.events.on('reservation.created', () => { throw new Error('x'); }); } };
  const b = { id: 'school-holidays', register(ctx) { ctx.events.on('reservation.created', (p) => seen.push(['b', p.reservationId])); } };
  const c = { id: 'gate-access', register(ctx) { ctx.events.on('reservation.created', (p) => seen.push(['c', p.reservationId])); } };
  boot(db, { installed: ['weather-alerts', 'school-holidays', 'gate-access'], active: ['weather-alerts', 'school-holidays'], modules: [a, b, c] });
  const original = console.error;
  console.error = () => {};
  try { await eventBus.dispatch('reservation.created', { reservationId: 9 }); } finally { console.error = original; }
  assert.deepEqual(seen, [['b', 9]]);
  assert.throws(() => eventBus.emit('reservation.exploded', {}), /Unknown plugin event/);
});

test('rule 9: Google subscribes to the five events it used to be called for', () => {
  const db = freshDb();
  boot(db, { installed: [] });
  assert.deepEqual([...registry.get('google-calendar').handlers.keys()].sort(), [...eventBus.EVENTS].sort());
});

// ---------- email variables (rule 10) ----------

test('rule 10: the gate variables are filled while the plugin is active, empty and false when it is not', () => {
  const db = freshDb();
  boot(db, { installed: ['gate-access'] });
  db.prepare(`INSERT INTO gate_key_results (reservationId, action, ok, state, code, url, receivedAt)
    VALUES (5, 'create', 1, 'active', '4K7M', 'https://x/#i=y', '2026-09-28')`).run();
  assert.deepEqual(eventBus.emailContext(5), {
    tokens: { gateAccessCode: '4K7M', gateAccessUrl: 'https://x/#i=y' }, flags: { hasGateAccess: true },
  });
  buildPluginsModel(db).setEnabled('gate-access', false);
  assert.deepEqual(eventBus.emailContext(5), {
    tokens: { gateAccessCode: '', gateAccessUrl: '' }, flags: { hasGateAccess: false },
  });
});

test('rule 10: the four email paths take the plugin variables and no longer call gate code', () => {
  for (const rel of ['controllers/emailsController.js', 'utils/emailAutoSendRunner.js', 'utils/guestEmailSequenceRunner.js', 'utils/reservationEmailSender.js']) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    assert.match(src, /pluginContext: pluginEmailContext\(/, rel);
    assert.doesNotMatch(src, /gateInvitation|usableInvitation/, rel);
  }
});

// ---------- erasure (rule 12, rules 20-24) ----------

test('rule 12: the Plugins list says which plugins are erasable and what an erasure would take', () => {
  const db = freshDb();
  const { plugins } = boot(db, { installed: ['school-holidays', 'linen'] });
  db.prepare("INSERT INTO school_holidays (label) VALUES ('Toussaint'), ('Noël')").run();
  const res = fakeRes();
  createController(plugins, { registry, db: () => db }).list({}, res);
  const holidays = res.body.find((p) => p.id === 'school-holidays');
  assert.equal(holidays.hasModule, true);
  assert.equal(holidays.erasable, true);
  assert.deepEqual(holidays.data.map((l) => l.label), ['2 périodes de vacances', 'l’état de synchronisation']);
  const linen = res.body.find((p) => p.id === 'linen');
  assert.equal(linen.erasable, false);
  assert.deepEqual(linen.data, []);
});

test('rules 12, 24: erasing drops the tables, the settings and the ledger rows; a reinstall starts empty', async () => {
  const db = freshDb();
  const { plugins, settingsModel } = boot(db, { installed: ['weather-alerts'] });
  settingsModel.set('weather-alerts', 'apiKey', 'k', { secret: true });
  db.prepare("INSERT INTO weather_vigilance_cache VALUES ('07', '[]', '2026-09-28')").run();
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, loader: () => loader });
  const res = fakeRes();
  controller.uninstall({ params: { id: 'weather-alerts' }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, 'available');
  assert.equal(tableExists(db, 'weather_vigilance_cache'), false);
  assert.equal(settingsModel.raw('weather-alerts', 'apiKey'), '');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM migrations WHERE name LIKE 'plugin:weather-alerts:%'").get().n, 0);

  await controller.install({ params: { id: 'weather-alerts' } }, fakeRes());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM weather_vigilance_cache').get().n, 0);
});

test('rule 22: a plugin without a module refuses ?purge=1 and keeps its data', () => {
  const db = freshDb();
  const { plugins } = boot(db, { installed: ['linen'] });
  const res = fakeRes();
  createController(plugins, { registry, db: () => db }).uninstall({ params: { id: 'linen' }, query: { purge: '1' } }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'NOT_ERASABLE' });
  assert.ok(plugins.get('linen'));
});

test('rule 20: erasing the recipes keeps every season and price; the seasons become manual', () => {
  const db = freshDb();
  const { plugins } = boot(db, { installed: ['tariff-recipes'] });
  db.prepare("INSERT INTO properties (id, name, tariffRecipeId, tariffRecipeVersion) VALUES (1, 'Gîte', 'gite-2027', '3.0.0')").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, seasonKey) VALUES (1, 'Haute', 180, 'high')").run();
  createController(plugins, { registry, db: () => db, settingsModel: () => buildPluginSettingsModel(db) })
    .uninstall({ params: { id: 'tariff-recipes' }, query: { purge: '1' } }, fakeRes());
  assert.deepEqual(db.prepare('SELECT tariffRecipeId, tariffRecipeVersion FROM properties').get(), { tariffRecipeId: '', tariffRecipeVersion: '' });
  assert.deepEqual(db.prepare('SELECT label, pricePerNight, seasonKey FROM pricing_rules').get(), { label: 'Haute', pricePerNight: 180, seasonKey: null });
  assert.equal(tableExists(db, 'tariff_recipe_runs'), false);
});

test('rule 12: an erasure that fails halfway rolls everything back and keeps the plugin installed', () => {
  const db = freshDb();
  const mod = {
    id: 'weather-alerts',
    register(ctx) {
      ctx.migrations([{ name: 't', up: (d) => d.exec('CREATE TABLE IF NOT EXISTS w_t (x)') }]);
      ctx.data({ tables: ['w_t'], describe: () => [], purge: (d) => { d.exec('DROP TABLE w_t'); throw new Error('half'); } });
    },
  };
  const { plugins } = boot(db, { installed: ['weather-alerts'], modules: [mod] });
  const res = fakeRes();
  const original = console.error;
  console.error = () => {};
  try {
    createController(plugins, { registry, db: () => db, settingsModel: () => buildPluginSettingsModel(db) })
      .uninstall({ params: { id: 'weather-alerts' }, query: { purge: '1' } }, res);
  } finally { console.error = original; }
  assert.equal(res.statusCode, 500);
  assert.equal(tableExists(db, 'w_t'), true);
  assert.ok(plugins.get('weather-alerts'));
});

// ---------- gate paths that ran while inactive (§1), rules 17-18 ----------

test('rule 17: the SAS payload carries plugin data only for live plugins, and no gate field of its own', () => {
  const db = freshDb();
  boot(db, { installed: ['gate-access'] });
  db.prepare(`INSERT INTO gate_key_results (reservationId, action, ok, state, code, receivedAt)
    VALUES (5, 'create', 1, 'active', '4K7M', '2026-09-28')`).run();
  assert.deepEqual(eventBus.sasData(5), { 'gate-access': { available: true } });
  buildPluginsModel(db).setEnabled('gate-access', false);
  assert.deepEqual(eventBus.sasData(5), {});
  const sas = fs.readFileSync(path.join(SRC, 'controllers/sasController.js'), 'utf8');
  assert.match(sas, /portalCode: String\(settings\.portalCode/);
  assert.match(sas, /pluginData: pluginSasData\(reservation\.id\)/);
  assert.doesNotMatch(sas, /gateAccess:/);
});

test('rule 18: the connector keys are created by the plugin only, never by the core boot', () => {
  const index = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  assert.doesNotMatch(index, /GATE_API_KEY|GATE_SIGNING_SECRET/);
  const db = freshDb();
  boot(db, { installed: [] });
  const record = registry.get('gate-access');
  assert.equal(record.onBoot.length, 1);
  assert.equal(record.onInstall.length, 1);
});
