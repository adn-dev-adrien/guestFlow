/**
 * Seeds the plugins this branch ships as « installed but inactive » (specs/plugin-engine-backport.md
 * rule 3): nothing runs until the operator switches a plugin on.
 *
 * It records its OWN ledger entry. The plugins branch's `seedBuiltinPlugins` records
 * `plugins_builtin_seed_v1` and is never called here: calling it would make that branch's seed skip the
 * other plugins on databases that already went through this one.
 */

const LEDGER_NAME = 'plugins_backport_seed_v1';

function seedBackportPlugins(db, pluginIds) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(LEDGER_NAME)) return;
  const insert = db.prepare("INSERT OR IGNORE INTO plugins (id, enabled, source) VALUES (?, 0, 'builtin')");
  db.transaction(() => {
    pluginIds.forEach((id) => insert.run(id));
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(LEDGER_NAME);
  })();
}

module.exports = { LEDGER_NAME, seedBackportPlugins };
