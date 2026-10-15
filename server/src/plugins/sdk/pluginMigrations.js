/**
 * A plugin's own tables (specs/plugins-phase-1-sdk.md rule 6). Each migration runs once, in a
 * transaction, and is recorded in the core `migrations` ledger as `plugin:<id>:<name>`. Every `up`
 * must be idempotent: on a database that predates the plugin module the tables already exist and the
 * first run only records the ledger row.
 */

const ledgerName = (pluginId, name) => `plugin:${pluginId}:${name}`;

function runPluginMigrations(db, pluginId, migrations) {
  const has = db.prepare('SELECT 1 FROM migrations WHERE name = ?');
  const record = db.prepare('INSERT INTO migrations (name) VALUES (?)');
  let ran = 0;
  migrations.forEach(({ name, up }) => {
    const ledger = ledgerName(pluginId, name);
    if (has.get(ledger)) return;
    db.transaction(() => {
      up(db);
      record.run(ledger);
    })();
    ran += 1;
  });
  return ran;
}

function forgetPluginMigrations(db, pluginId) {
  return db.prepare('DELETE FROM migrations WHERE name LIKE ?').run(`${ledgerName(pluginId, '')}%`).changes;
}

module.exports = { runPluginMigrations, forgetPluginMigrations, ledgerName };
