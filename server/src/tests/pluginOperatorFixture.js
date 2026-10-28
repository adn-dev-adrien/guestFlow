// Shared by the plugin-operator-* suites (specs/plugin-operator-provisioning.md): a space on an
// in-memory database, a licence stand-in, and the real plugins controller / reconciler on top.
const Database = require('better-sqlite3');

const { PLUGIN_CATALOG, findPlugin } = require('../constants/plugins');
const { ensurePluginsTable, ensureProvisioningTables } = require('../utils/pluginsSchema');
const pluginsModel = require('../models/pluginsModel');
const provisioningModel = require('../models/pluginProvisioningModel');
const { createController } = require('../controllers/pluginsController');
const { createReconciler } = require('../utils/pluginReconciler');

// A licence reader as the reconciler and the governance read it.
function licenceReader({ plugins, active = null, eraseOrders = [], issuedAt = '2026-10-28T08:00:00.000Z' } = {}) {
  const state = { plugins: plugins || PLUGIN_CATALOG.map((p) => p.id), active, eraseOrders, issuedAt };
  return {
    state,
    activePlugins: () => state.active,
    eraseOrders: () => state.eraseOrders,
    issuedAt: () => state.issuedAt,
    allowsPlugin: (id) => state.plugins.includes(id),
    planFor: () => null,
  };
}

function space({ installed = [], active = null, plugins, eraseOrders = [], data = {}, blockers = {}, now = () => new Date('2026-10-28T08:00:00Z') } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER, role TEXT, PRIMARY KEY (userId, role));
    CREATE TABLE linen_stock (id INTEGER PRIMARY KEY, n INTEGER);
  `);
  ensurePluginsTable(db);
  ensureProvisioningTables(db);
  const model = pluginsModel.buildModel(db);
  installed.forEach((entry) => {
    const [id, enabled = true] = Array.isArray(entry) ? entry : [entry];
    model.install(id, { source: 'bundled', manifest: findPlugin(id) });
    if (!enabled) model.setEnabled(id, false);
  });
  Object.entries(blockers).forEach(([id, n]) => {
    if (id === 'online-payment') for (let i = 0; i < n; i += 1) db.prepare("INSERT INTO payment_links (status) VALUES ('open')").run();
  });
  const licence = licenceReader({ plugins, active, eraseOrders });
  const registry = {
    get: (id) => (data[id] ? { data: data[id], settings: [] } : null),
    isLive: () => true,
  };
  const controller = createController(model, {
    licence: () => ({ allowsPlugin: licence.allowsPlugin, planFor: licence.planFor }),
    registry,
    db: () => db,
    settingsModel: () => ({ deleteAll() {} }),
    now,
  });
  const provisioning = provisioningModel.buildModel(db);
  const clock = { t: now() };
  const build = () => createReconciler({
    licence, model, provisioning, controller, catalogue: PLUGIN_CATALOG, now: () => clock.t,
  });
  // `rebuild()` after a test replaced a handler of `controller`.
  return { db, model, provisioning, controller, licence, reconciler: build(), rebuild: build, clock };
}

module.exports = { space, licenceReader };
