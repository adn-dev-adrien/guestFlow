/**
 * `user_push_channel_prefs` — the toggles of the push channels plugins declare
 * (specs/platform-settings-relay-and-review.md rule 8): the table on every boot, and the one-shot
 * `push_channel_prefs_v1` that carries the « Souscriptions Neat » choices of the former
 * `user_push_prefs.neat` column over. Only an « off » is worth a row: no row reads ON.
 */

const MIGRATION = 'push_channel_prefs_v1';

function applyPushChannelPrefsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_push_channel_prefs (
      userId INTEGER NOT NULL,
      channel TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (userId, channel),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

function runPushChannelPrefsMigration(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION)) return { action: 'skipped' };
  const hasNeat = db.prepare('PRAGMA table_info(user_push_prefs)').all().some((c) => c.name === 'neat');
  let carried = 0;
  db.transaction(() => {
    if (hasNeat) {
      carried = db.prepare(`
        INSERT OR IGNORE INTO user_push_channel_prefs (userId, channel, enabled)
        SELECT userId, 'neat', 0 FROM user_push_prefs WHERE neat = 0
      `).run().changes;
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION);
  })();
  return { action: 'migrated', carried };
}

module.exports = { applyPushChannelPrefsSchema, runPushChannelPrefsMigration, MIGRATION };
