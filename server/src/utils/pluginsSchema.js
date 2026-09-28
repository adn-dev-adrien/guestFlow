/**
 * Schema and first seed of the `plugins` table (specs/plugins-phase-0-foundation.md §5, rules 10–12).
 *
 * No row = the plugin is available (not installed). A database that already holds a property or a
 * reservation when the seed runs is an existing install: it gets the twelve built-ins installed and
 * active, so nothing disappears after the update. A fresh database gets none. The seed is recorded in
 * the `migrations` ledger and never runs twice, so an operator who later uninstalls everything is not
 * re-seeded at the next boot.
 */

const { PLUGIN_IDS } = require('../constants/plugins');

const SEED_MIGRATION = 'plugins_builtin_seed_v1';

function ensurePluginsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id           TEXT PRIMARY KEY,
      enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      source       TEXT NOT NULL DEFAULT 'builtin',
      version      TEXT,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedBuiltinPlugins(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SEED_MIGRATION)) return false;
  const existing = db.prepare('SELECT 1 FROM properties LIMIT 1').get()
    || db.prepare('SELECT 1 FROM reservations LIMIT 1').get();
  const insert = db.prepare("INSERT OR IGNORE INTO plugins (id, enabled, source) VALUES (?, 1, 'builtin')");
  db.transaction(() => {
    if (existing) PLUGIN_IDS.forEach((id) => insert.run(id));
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(SEED_MIGRATION);
  })();
  return Boolean(existing);
}

module.exports = { ensurePluginsTable, seedBuiltinPlugins, SEED_MIGRATION };
