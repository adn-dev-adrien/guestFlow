/**
 * Two per-platform guest-contact settings (specs/platform-settings-relay-and-review.md rules 1-6):
 *   - `platforms.relaysGuestEmail` — the platform hands out a relay address instead of the guest's own;
 *   - `platforms.reviewWhereFr` / `reviewWhereEn` — where its guests leave a review, as the J+1
 *     e-mail words it (« votre espace Gîtes de France »).
 *
 * The columns on every boot, and the one-shot `platform_guest_contact_v1` that writes on an existing
 * database what the code used to know by name: Airbnb and Booking relay the address, and the J+1 e-mail
 * named three platforms its own way. That knowledge lives here, as a migration of existing data, and
 * nowhere else: a new database has nothing ticked nor written, and the operator decides per platform
 * in Paramètres › Plateformes.
 */

const MIGRATION = 'platform_guest_contact_v1';

// The same reduction the code applied: letters only, so « Booking.com » and `BookingCom` both match.
const letters = (name) => String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');

const wasRelay = (name) => letters(name).startsWith('airbnb') || letters(name).startsWith('booking');

// The wordings stayContentContext.js hard-coded until this migration, in its order of tests.
function formerReviewWhere(name) {
  const key = letters(name);
  if (key.startsWith('gitesdefrance') || key.startsWith('gite')) return { fr: 'votre espace Gîtes de France', en: 'your Gîtes de France account' };
  if (key.startsWith('airbnb')) return { fr: 'Airbnb', en: 'Airbnb' };
  if (key.startsWith('booking')) return { fr: 'Booking', en: 'Booking' };
  return null;
}

function applyPlatformGuestContactSchema(db) {
  const columns = db.prepare('PRAGMA table_info(platforms)').all().map((c) => c.name);
  if (columns.length === 0) return;
  if (!columns.includes('relaysGuestEmail')) db.exec('ALTER TABLE platforms ADD COLUMN relaysGuestEmail INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('reviewWhereFr')) db.exec('ALTER TABLE platforms ADD COLUMN reviewWhereFr TEXT');
  if (!columns.includes('reviewWhereEn')) db.exec('ALTER TABLE platforms ADD COLUMN reviewWhereEn TEXT');
}

function runPlatformGuestContactMigration(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION)) return { action: 'skipped' };
  const rows = db.prepare('SELECT id, name FROM platforms').all();
  const tick = db.prepare('UPDATE platforms SET relaysGuestEmail = 1 WHERE id = ?');
  const write = db.prepare('UPDATE platforms SET reviewWhereFr = ?, reviewWhereEn = ? WHERE id = ?');
  let relays = 0;
  let reviews = 0;
  db.transaction(() => {
    rows.forEach((p) => {
      if (wasRelay(p.name)) { tick.run(p.id); relays += 1; }
      const where = formerReviewWhere(p.name);
      if (where) { write.run(where.fr, where.en, p.id); reviews += 1; }
    });
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION);
  })();
  return { action: 'migrated', relays, reviews };
}

module.exports = { applyPlatformGuestContactSchema, runPlatformGuestContactMigration, MIGRATION };
