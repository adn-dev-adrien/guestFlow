/**
 * `platforms.forbidsGuestChores` (specs/airbnb-no-checkout-chores.md rule 8): the column on every boot,
 * and the one-shot `chore_free_channels_v1` that ticks it on the Airbnb rows of an existing database.
 *
 * Until this flag, the code recognised Airbnb by its name. That knowledge is kept here, as a migration
 * of existing data, and nowhere else: a new database has no channel ticked, and the operator decides
 * per platform in Paramètres › Plateformes.
 */

const MIGRATION = 'chore_free_channels_v1';

// Slugged prefix: an iCal source labelled « Airbnb Tente » is stored `AirbnbTente`.
const wasRecognisedAsAirbnb = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').startsWith('airbnb');

function applyChoreFreeChannelsSchema(db) {
  const columns = db.prepare('PRAGMA table_info(platforms)').all().map((c) => c.name);
  if (columns.length > 0 && !columns.includes('forbidsGuestChores')) {
    db.exec('ALTER TABLE platforms ADD COLUMN forbidsGuestChores INTEGER NOT NULL DEFAULT 0');
  }
}

function runChoreFreeChannelsMigration(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION)) return { action: 'skipped' };
  const tick = db.prepare('UPDATE platforms SET forbidsGuestChores = 1 WHERE id = ?');
  const ids = db.prepare('SELECT id, name FROM platforms').all().filter((p) => wasRecognisedAsAirbnb(p.name)).map((p) => p.id);
  db.transaction(() => {
    ids.forEach((id) => tick.run(id));
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION);
  })();
  return { action: 'migrated', ticked: ids.length };
}

module.exports = { applyChoreFreeChannelsSchema, runChoreFreeChannelsMigration, MIGRATION };
