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

const DIRECT_NAME = 'direct';

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
