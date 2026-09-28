/**
 * Test helper: creates a plugin module's tables on a bare database (specs/plugins-phase-1-sdk.md
 * rule 6). Core suites build their database from schema.sql, which no longer holds plugin tables.
 * The module registers against a capture context, so the global registry is left untouched.
 */

const { runPluginMigrations } = require('./pluginMigrations');

function captureContext(id, migrations) {
  const noop = new Proxy(function noop() {}, { get: () => noop, apply: () => noop });
  return new Proxy({}, {
    get(_, key) {
      if (key === 'id') return id;
      if (key === 'migrations') return (list) => migrations.push(...list);
      return noop;
    },
  });
}

function applyPluginSchema(db, id) {
  const mod = require('../index').find((m) => m.id === id);
  if (!mod) throw new Error(`No plugin module "${id}"`);
  const migrations = [];
  mod.register(captureContext(id, migrations));
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  return runPluginMigrations(db, id, migrations);
}

module.exports = { applyPluginSchema };
