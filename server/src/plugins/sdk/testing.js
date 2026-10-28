/**
 * Test helper: creates a plugin module's tables on a bare database (specs/plugins-phase-1-sdk.md
 * rule 6). Core suites build their database from schema.sql, which no longer holds plugin tables.
 * The module registers against a capture context, so the global registry is left untouched.
 */

const fs = require('fs');
const path = require('path');
const { runPluginMigrations } = require('./pluginMigrations');

const PLUGINS_DIR = path.join(__dirname, '..');

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

/**
 * specs/plugin-removal-resilience.md rules 4, 13 — which plugins this tree ships, read from the
 * folders (a folder holding a `manifest.json`), so a suite never lists them by hand and never
 * assumes one exists.
 */
function listPlugins() {
  return fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PLUGINS_DIR, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort();
}

/** → the ids of `ids` that are not shipped. */
function missingPlugins(ids) {
  const shipped = listPlugins();
  return ids.filter((id) => !shipped.includes(id));
}

/**
 * A test file that proves something about plugin code opens with
 * `if (!requirePlugins(['a', 'b'])) return;` — before it requires any of them. When one is not shipped
 * the file registers one skipped test named `skipped: requires <ids>` and returns false.
 */
function requirePlugins(ids) {
  const missing = missingPlugins(ids);
  if (!missing.length) return true;
  const label = `requires ${missing.join(', ')}`;
  require('node:test').test(`skipped: ${label}`, { skip: label }, () => {});
  return false;
}

/**
 * For one test inside a mixed file: `test(name, { skip: skipWithout(['a']) }, fn)` — the skip reason
 * (`requires a`) while a plugin is not shipped, `false` otherwise.
 */
function skipWithout(ids) {
  const missing = missingPlugins(ids);
  return missing.length ? `requires ${missing.join(', ')}` : false;
}

module.exports = { applyPluginSchema, listPlugins, missingPlugins, requirePlugins, skipWithout };
