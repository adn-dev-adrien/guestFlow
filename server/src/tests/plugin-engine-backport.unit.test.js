// specs/plugin-engine-backport.md — the minimal plugin engine on master: the two tables, the seed
// (installed but inactive), the 404 of an inactive plugin, activation, the guards, a plugin that fails,
// settings, the shared update service, isolation.
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
const MODULES = require('../plugins');
const { PLUGIN_IDS, PLUGIN_CATALOG } = require('../constants/plugins');
const { buildModel: buildPluginsModel } = require('../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../models/pluginSettingsModel');
const { createController } = require('../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../utils/pluginsSchema');
const { seedBackportPlugins, LEDGER_NAME } = require('../utils/pluginsBackportSeed');
const { isEncrypted } = require('../utils/encryption');
const authController = require('../controllers/authController');
const reservationsController = require('../controllers/reservationsController');

const SRC = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(SRC, 'schema.sql'), 'utf8');
const GDF = 'gites-de-france-intake';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  return db;
}

function probeModule({ failRegister = false, failMigration = false } = {}) {
  const ran = { job: 0 };
  return {
    id: 'probe',
    ran,
    register(ctx) {
      if (failRegister) throw new Error('register boom');
      const router = express.Router();
      router.get('/ping', (_req, res) => res.json({ ok: true }));
      ctx.mount('/api/probe', router);
      ctx.migrations([{
        name: 'probe_table_v1',
        up: (db) => { if (failMigration) throw new Error('migration boom'); db.exec('CREATE TABLE probe_t (id INTEGER)'); },
      }]);
      ctx.jobs.every({ name: 'tick', intervalMs: 1000, run: async () => { ran.job += 1; } });
    },
  };
}

// Boots `modules` on `db`; `state` is the plugins row of 'probe': 'active' | 'inactive' | undefined (no row).
function boot(db, modules, state) {
  registry.reset();
  const plugins = buildPluginsModel(db);
  if (state) {
    plugins.install('probe');
    if (state === 'inactive') plugins.setEnabled('probe', false);
  }
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules, settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const app = express();
  app.use(express.json());
  loader.mountApi(app);
  return { app, plugins, settingsModel };
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

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.afterEach(() => registry.reset());

// ---------- rule 1 — the engine and nothing else ----------

test('specs/plugin-engine-backport.md rule 1: the catalogue lists the plugins shipped here and nothing of the wider branch', () => {
  assert.deepEqual(PLUGIN_CATALOG.map((p) => p.id), MODULES.map((m) => m.id));
  [
    'utils/licence.js', 'middleware/enforceSubscription.js', 'plugins/neat', 'plugins/linen', 'plugins/sas',
  ].forEach((rel) => assert.equal(fs.existsSync(path.join(SRC, rel)), false, rel));
  const ctrl = createController(buildPluginsModel(freshDb()));
  ['install', 'uninstall'].forEach((name) => assert.equal(ctrl[name], undefined, name));
});

// ---------- rule 3 — seeded installed but inactive, with its own ledger ----------

test('specs/plugin-engine-backport.md rule 3: the plugins are seeded installed but inactive, once, under their own ledger', () => {
  const db = freshDb();
  const plugins = buildPluginsModel(db);
  seedBackportPlugins(db, PLUGIN_IDS);
  PLUGIN_IDS.forEach((id) => {
    const row = plugins.get(id);
    assert.ok(row, id);
    assert.equal(row.enabled, false);
  });
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(LEDGER_NAME));
  assert.equal(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get('plugins_builtin_seed_v1'), undefined,
    'the plugins branch\'s ledger entry is never written here');
  assert.notEqual(LEDGER_NAME, 'plugins_builtin_seed_v1');

  plugins.setEnabled(PLUGIN_IDS[0], true);
  seedBackportPlugins(db, PLUGIN_IDS);
  assert.equal(plugins.get(PLUGIN_IDS[0]).enabled, true, 'a second boot never switches an activated plugin off');
});

// ---------- rule 4 — inactive means absent ----------

test('specs/plugin-engine-backport.md rule 4: an inactive plugin answers 404 PLUGIN_INACTIVE, an active one is served', async () => {
  const inactive = boot(freshDb(), [probeModule()], 'inactive');
  assert.deepEqual(await get(inactive.app, '/api/probe/ping'), { status: 404, body: { error: 'PLUGIN_INACTIVE', plugin: 'probe' } });
  const noRow = boot(freshDb(), [probeModule()]);
  assert.equal((await get(noRow.app, '/api/probe/ping')).status, 404);
  const active = boot(freshDb(), [probeModule()], 'active');
  assert.deepEqual(await get(active.app, '/api/probe/ping'), { status: 200, body: { ok: true } });
});

test('specs/plugin-engine-backport.md rule 4: a job does not tick while its plugin is inactive, and runs once it is active', async () => {
  const mod = probeModule();
  const { plugins } = boot(freshDb(), [mod], 'inactive');
  const timers = [];
  loader.startJobs({ setIntervalFn: (fn) => timers.push(fn), setTimeoutFn: () => {} });
  await timers[0]();
  assert.equal(mod.ran.job, 0);
  plugins.setEnabled('probe', true);
  await timers[0]();
  assert.equal(mod.ran.job, 1);
});

test('specs/plugin-engine-backport.md rule 4: login and /me carry enabledPlugins — the live ones only', () => {
  const live = new Set(['b']);
  const users = {
    verifyCredentials: () => ({ id: 1, email: 'a@b.c', isActive: true }),
    findById: () => ({ id: 1, email: 'a@b.c', isActive: true }),
  };
  const ctrl = authController.create(users, {}, { activePlugins: () => [...live] });
  const res = fakeRes();
  ctrl.login({ body: { email: 'a@b.c', password: 'x' }, session: {} }, res);
  assert.deepEqual(res.body.enabledPlugins, ['b']);
  const me = fakeRes();
  ctrl.me({ session: { user: { id: 1 } } }, me);
  assert.deepEqual(me.body.enabledPlugins, ['b']);
  live.clear();
  const again = fakeRes();
  ctrl.me({ session: { user: { id: 1 } } }, again);
  assert.deepEqual(again.body.enabledPlugins, []);
});

// ---------- rule 5 — activation ----------

test('specs/plugin-engine-backport.md rule 5: list, activate and deactivate; an unknown id is 404, a plugin without a row 409', () => {
  const db = freshDb();
  const model = buildPluginsModel(db);
  const ctrl = createController(model);

  let res = fakeRes();
  ctrl.activate({ params: { id: GDF } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'NOT_INSTALLED');

  seedBackportPlugins(db, PLUGIN_IDS);
  res = fakeRes();
  ctrl.list({}, res);
  assert.deepEqual(res.body.map((p) => [p.id, p.enabled]), PLUGIN_IDS.map((id) => [id, false]));

  res = fakeRes();
  ctrl.activate({ params: { id: GDF } }, res);
  assert.equal(res.body.enabled, true);
  assert.equal(model.isActive(GDF), true);

  res = fakeRes();
  ctrl.deactivate({ params: { id: GDF } }, res);
  assert.equal(res.body.enabled, false);
  assert.equal(model.isActive(GDF), false);

  res = fakeRes();
  ctrl.activate({ params: { id: 'nope' } }, res);
  assert.equal(res.statusCode, 404);
});

// ---------- rule 6 — behind the core guards ----------

test('specs/plugin-engine-backport.md rule 6: plugin routes are mounted after the session and role guards; public mounts live under /public/', () => {
  const source = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  const at = (needle) => {
    const i = source.indexOf(needle);
    assert.ok(i > 0, needle);
    return i;
  };
  const sessionGuard = at('return requireAuth(req, res, next);');
  const roleGuard = at('return enforceRoleAccess(req, res, next);');
  assert.ok(at("app.use('/api/plugins'") > roleGuard && at('pluginLoader.mountApi(app)') > roleGuard);
  assert.ok(at("app.use('/api/plugins'") > sessionGuard);
  assert.ok(at('pluginLoader.mountPublic(app)') < sessionGuard, 'the public mount sits outside the /api guards');

  const publicOk = { id: 'x', register: (ctx) => ctx.mount('/public/x', express.Router(), { public: true }) };
  const publicBad = { id: 'y', register: (ctx) => ctx.mount('/api/y', express.Router(), { public: true }) };
  registry.reset();
  loader.registerAll({ db: freshDb(), modules: [publicOk, publicBad], settingsModel: () => buildPluginSettingsModel(freshDb()), isInstalled: () => false });
  assert.equal(registry.get('x').failed, null);
  assert.match(registry.get('y').failed, /public mounts must live under \/public\//);
});

// ---------- rule 7 — a failing plugin never blocks the boot ----------

test('specs/plugin-engine-backport.md rule 7: a throwing register or migration marks that plugin failed, its routes answer 404, the others boot', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const bad = boot(freshDb(), [probeModule({ failRegister: true })], 'active');
    assert.equal(registry.get('probe').failed, 'register boom');
    assert.equal(registry.isLive('probe'), false);
    assert.equal((await get(bad.app, '/api/probe/ping')).status, 404);

    const db = freshDb();
    const other = { id: 'other', register: () => {} };
    boot(db, [probeModule({ failMigration: true }), other], 'active');
    assert.equal(registry.get('probe').failed, 'migration boom');
    assert.equal(registry.get('other').failed, null);
  } finally {
    console.error = original;
  }
  assert.ok(errors.length >= 2);
});

// ---------- rule 8 — everything off is today's GuestFlow ----------

test('specs/plugin-engine-backport.md rule 8: right after the seed no plugin is live, no job runs and nothing is exposed to the client', () => {
  const db = freshDb();
  seedBackportPlugins(db, PLUGIN_IDS);
  const model = buildPluginsModel(db);
  registry.reset();
  registry.configure({ isActive: (id) => model.isActive(id) });
  loader.registerAll({ db, modules: MODULES, settingsModel: () => buildPluginSettingsModel(db), isInstalled: (id) => Boolean(model.get(id)) });
  PLUGIN_IDS.forEach((id) => assert.equal(registry.isLive(id), false, id));
  assert.deepEqual(model.listActiveIds(), []);
});

// ---------- rule 9 — settings and secrets ----------

test('specs/plugin-engine-backport.md rule 9: a secret is encrypted at rest and read back as `<key>Set`; an undeclared key is refused', () => {
  const db = freshDb();
  const settings = buildPluginSettingsModel(db);
  settings.set('probe', 'token', 'sekret-value', { secret: true });
  settings.set('probe', 'label', 'visible', { secret: false });
  assert.equal(isEncrypted(settings.raw('probe', 'token')), true);
  const view = settings.httpView('probe', [{ key: 'token', secret: true }, { key: 'label' }]);
  assert.equal(view.tokenSet, true);
  assert.equal(view.token, undefined);
  assert.equal(view.label, 'visible');
  assert.equal(JSON.stringify(view).includes('sekret-value'), false);

  let ctx = null;
  registry.reset();
  loader.registerAll({ db, modules: [{ id: 'probe', register(c) { ctx = c; c.settings.declare([{ key: 'label' }]); } }], settingsModel: () => settings, isInstalled: () => false });
  assert.throws(() => ctx.settings.set('other', 'x'), /undeclared setting/);
});

// ---------- rule 10 — the shared update service ----------

test('specs/plugin-engine-backport.md rule 10: the HTTP save and the plugin service are one code path', () => {
  assert.equal(typeof reservationsController.update, 'function');
  assert.equal(typeof reservationsController.performUpdate, 'function');
  const source = fs.readFileSync(path.join(SRC, 'controllers', 'reservationsController.js'), 'utf8');
  assert.match(source, /function update\(req, res\) \{\s*const result = performUpdate\(/);
  const core = fs.readFileSync(path.join(SRC, 'plugins', 'sdk', 'coreServices.js'), 'utf8');
  assert.match(core, /reservationsController\(\)\.performUpdate\(/);
});

// ---------- rule 12 — isolation ----------

function readTree(dir, acc = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') readTree(full, acc); return; }
    if (e.name.endsWith('.js')) acc.push(full);
  });
  return acc;
}

test('specs/plugin-engine-backport.md rule 12: no core file mentions a plugin\'s table, route or folder outside the registration files', () => {
  const allowed = new Set(['plugins/index.js', 'constants/plugins.js']);
  const offenders = readTree(SRC).map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((rel) => !rel.startsWith('plugins/') && !rel.startsWith('tests/') && !allowed.has(rel))
    .filter((rel) => /gdf_intakes|\/api\/gdf-intake|gites-de-france-intake/.test(fs.readFileSync(path.join(SRC, rel), 'utf8')));
  assert.deepEqual(offenders, []);
});
