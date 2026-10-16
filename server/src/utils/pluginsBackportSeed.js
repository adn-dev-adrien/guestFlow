/**
 * Seeds the plugins this branch ships as « installed but inactive » (specs/plugin-engine-backport.md
 * rule 3): nothing runs until the operator switches a plugin on.
 *
 * Each batch has its OWN ledger entry, so a plugin shipped later is
 * seeded on the databases that already went through the first one — and a plugin the operator removed is
 * never seeded back. The plugins branch's `seedBuiltinPlugins` records `plugins_builtin_seed_v1` and is
 * never called here: calling it would make that branch's seed skip the other plugins on databases that
 * already went through this one.
 */

const BATCHES = require('../constants/plugins').PLUGIN_SEED_BATCHES;

const LEDGER_NAME = BATCHES[0].ledger;

function seedBackportPlugins(db, batches = BATCHES) {
  const insert = db.prepare("INSERT OR IGNORE INTO plugins (id, enabled, source) VALUES (?, 0, 'builtin')");
  batches.forEach(({ ledger, ids }) => {
    if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(ledger)) return;
    db.transaction(() => {
      ids.forEach((id) => insert.run(id));
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(ledger);
    })();
  });
}

module.exports = { BATCHES, LEDGER_NAME, seedBackportPlugins };
