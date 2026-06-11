/**
 * Platforms model — CRUD on the deduped per-platform commission config.
 *
 * The `platforms` table holds ONE row per unique platform name across the whole app — seeded
 * once at boot from `DISTINCT ical_sources.platformLabel` and topped up on every iCal source
 * create/update through `upsertByName`. The Direct row (id 1, name 'direct') is always
 * present and never editable.
 *
 * Spec: specs/accounting-platform-commission-and-no-deposit.md §3.1.
 *
 * Factory `create(db)` (+ a default bound to the production DB), mirroring the other models.
 */

const db = require('../database');
const { formatPlatformName } = require('../utils/platformNameFormat');
const { KNOWN_PLATFORM_COLORS } = require('../constants/platformColors');

const DIRECT_NAME = 'direct';

// Canonical display names of the built-in well-known platforms ('Airbnb', 'Booking', …) derived
// from the shared colour map so they stay in sync. These are always offered in the dropdowns even
// before any reservation or iCal source has used them.
const KNOWN_PLATFORM_NAMES = Object.keys(KNOWN_PLATFORM_COLORS)
  .map((slug) => formatPlatformName(slug))
  .filter(Boolean);

function createPlatformsModel(database) {
  const stmts = {
    listAll: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission
      FROM platforms
      ORDER BY (name = '${DIRECT_NAME}') DESC, name COLLATE NOCASE ASC
    `),
    findByName: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission
      FROM platforms WHERE name = ?
    `),
    findById: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission
      FROM platforms WHERE id = ?
    `),
    upsert: database.prepare("INSERT OR IGNORE INTO platforms (name) VALUES (?)"),
    update: database.prepare(`
      UPDATE platforms
         SET commissionAccountNumber = ?,
             hasVatOnCommission = ?
       WHERE id = ?
    `),
  };

  return {
    listAll() {
      return stmts.listAll.all();
    },
    // Canonical, deduped list of platform NAMES for the UI dropdowns (reservation form + iCal
    // source form). Union of the built-in well-known platforms and every name stored in the
    // `platforms` table — which is itself topped up from `ical_sources.platformLabel` +
    // `reservations.platform` (see rescan/upsertByName). This is what makes a platform added in a
    // logement's iCal imports show up in the dropdowns. 'direct' is forced first, then alphabetical
    // (case-insensitive). Deduped on the canonical form so 'Airbnb'/'airbnb' collapse to one entry.
    listNames() {
      const byCanonical = new Map(); // lowercased canonical → canonical display name
      for (const raw of [...KNOWN_PLATFORM_NAMES, ...stmts.listAll.all().map((r) => r.name)]) {
        const canonical = formatPlatformName(raw);
        if (!canonical) continue;
        const key = canonical.toLowerCase();
        if (!byCanonical.has(key)) byCanonical.set(key, canonical);
      }
      return [...byCanonical.values()].sort((a, b) => {
        if (a.toLowerCase() === DIRECT_NAME) return -1;
        if (b.toLowerCase() === DIRECT_NAME) return 1;
        return a.localeCompare(b, 'fr', { sensitivity: 'base' });
      });
    },
    findByName(name) {
      if (name == null || name === '') return null;
      return stmts.findByName.get(String(name)) || null;
    },
    findById(id) {
      if (id == null) return null;
      return stmts.findById.get(Number(id)) || null;
    },
    // specs/normalize-platform-names.md §3.2 rule 10 — belt-and-suspenders: format the input
    // even though the model's callers (propertyIcalModel + reservationsModel) already feed a
    // canonical string. Guards against a future caller that bypasses those hooks.
    upsertByName(name) {
      const canonical = formatPlatformName(name);
      if (canonical == null || canonical === '') return null;
      stmts.upsert.run(canonical);
      return stmts.findByName.get(canonical) || null;
    },
    // Re-run the union INSERT OR IGNORE from `ical_sources.platformLabel` +
    // `reservations.platform` so any platform that appeared since the last boot/upsert lands on
    // the dedicated config page. Idempotent: existing rows are untouched. Returns the number
    // of new platforms inserted so the UI can flash a friendly "+N nouvelles plateformes"
    // toast on the operator's refresh click.
    rescan() {
      const before = database.prepare('SELECT COUNT(*) AS c FROM platforms').get().c;
      database.exec(`
        INSERT OR IGNORE INTO platforms (name)
        SELECT DISTINCT platformLabel FROM ical_sources
         WHERE platformLabel IS NOT NULL AND platformLabel != ''
      `);
      database.exec(`
        INSERT OR IGNORE INTO platforms (name)
        SELECT DISTINCT platform FROM reservations
         WHERE platform IS NOT NULL AND platform != '' AND LOWER(platform) != 'direct'
      `);
      const after = database.prepare('SELECT COUNT(*) AS c FROM platforms').get().c;
      return Math.max(0, after - before);
    },
    // Guard against editing the Direct row. The spec says Direct fields are server-side
    // ignored — never written. Returns the unchanged row, mirroring update()'s contract.
    update({ id, commissionAccountNumber, hasVatOnCommission }) {
      const row = stmts.findById.get(Number(id));
      if (!row) return null;
      if (row.name === DIRECT_NAME) return row;
      const account = commissionAccountNumber == null || commissionAccountNumber === ''
        ? null
        : String(commissionAccountNumber);
      const hasVat = hasVatOnCommission === true || Number(hasVatOnCommission) === 1 ? 1 : 0;
      stmts.update.run(account, hasVat, Number(id));
      return stmts.findById.get(Number(id));
    },
  };
}

const defaultModel = createPlatformsModel(db);
defaultModel.create = createPlatformsModel;
defaultModel.DIRECT_NAME = DIRECT_NAME;

module.exports = defaultModel;
