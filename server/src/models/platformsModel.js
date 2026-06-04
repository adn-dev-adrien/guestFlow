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

const DIRECT_NAME = 'direct';

function createPlatformsModel(database) {
  const stmts = {
    listAll: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission, commissionRatePercent
      FROM platforms
      ORDER BY (name = '${DIRECT_NAME}') DESC, name COLLATE NOCASE ASC
    `),
    findByName: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission, commissionRatePercent
      FROM platforms WHERE name = ?
    `),
    findById: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission, commissionRatePercent
      FROM platforms WHERE id = ?
    `),
    upsert: database.prepare("INSERT OR IGNORE INTO platforms (name) VALUES (?)"),
    update: database.prepare(`
      UPDATE platforms
         SET commissionAccountNumber = ?,
             hasVatOnCommission = ?,
             commissionRatePercent = ?
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
    upsertByName(name) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return null;
      stmts.upsert.run(trimmed);
      return stmts.findByName.get(trimmed) || null;
    },
    // Guard against editing the Direct row. The spec says Direct fields are server-side
    // ignored — never written. Returns the unchanged row, mirroring update()'s contract.
    update({ id, commissionAccountNumber, hasVatOnCommission, commissionRatePercent }) {
      const row = stmts.findById.get(Number(id));
      if (!row) return null;
      if (row.name === DIRECT_NAME) return row;
      const account = commissionAccountNumber == null || commissionAccountNumber === ''
        ? null
        : String(commissionAccountNumber);
      const hasVat = hasVatOnCommission === true || Number(hasVatOnCommission) === 1 ? 1 : 0;
      const rate = commissionRatePercent == null || commissionRatePercent === ''
        ? null
        : Number(commissionRatePercent);
      stmts.update.run(account, hasVat, rate, Number(id));
      return stmts.findById.get(Number(id));
    },
  };
}

const defaultModel = createPlatformsModel(db);
defaultModel.create = createPlatformsModel;
defaultModel.DIRECT_NAME = DIRECT_NAME;

module.exports = defaultModel;
