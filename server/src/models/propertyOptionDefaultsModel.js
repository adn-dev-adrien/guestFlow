/**
 * propertyOptionDefaultsModel — per-property option defaults for new reservations
 * (specs/weekly-bed-linen-tracking.md §3.7, 2026-06-03).
 *
 * The `property_option_defaults` table is decoupled from `property_options` (the existing
 * availability filter): a row here means "auto-add this option on every NEW reservation for
 * that property"; the `offered` boolean is the second binary flag ("inclus dans le tarif").
 *
 * Factory pattern (`buildModel(db)`) for unit-test isolation, identical to other models.
 */

function buildModel(database) {
  const upsertStmt = database.prepare(`
    INSERT INTO property_option_defaults (propertyId, optionId, offered)
    VALUES (?, ?, ?)
    ON CONFLICT(propertyId, optionId) DO UPDATE SET offered = excluded.offered
  `);
  const deleteStmt = database.prepare(
    'DELETE FROM property_option_defaults WHERE propertyId = ? AND optionId = ?'
  );
  const listForPropertyStmt = database.prepare(`
    SELECT optionId, offered
      FROM property_option_defaults
     WHERE propertyId = ?
     ORDER BY optionId
  `);
  const listForOptionStmt = database.prepare(`
    SELECT d.propertyId, d.offered, p.name AS propertyName
      FROM property_option_defaults d
      LEFT JOIN properties p ON p.id = d.propertyId
     WHERE d.optionId = ?
     ORDER BY p.name COLLATE NOCASE, d.propertyId
  `);

  return {
    /**
     * Upsert a default for (propertyId, optionId) with the supplied `offered` boolean.
     * Returns the persisted row shape.
     */
    set(propertyId, optionId, offered) {
      const pid = Number(propertyId);
      const oid = Number(optionId);
      const off = offered ? 1 : 0;
      upsertStmt.run(pid, oid, off);
      return { propertyId: pid, optionId: oid, offered: off === 1 };
    },

    /**
     * Idempotent unset — no row → no-op, no error. Returns the number of rows touched.
     */
    unset(propertyId, optionId) {
      const result = deleteStmt.run(Number(propertyId), Number(optionId));
      return Number(result.changes) || 0;
    },

    /**
     * Defaults for a given property → list shape consumed by the reservation form to
     * pre-populate `selectedOptions`.
     */
    listForProperty(propertyId) {
      return listForPropertyStmt.all(Number(propertyId)).map((row) => ({
        optionId: Number(row.optionId),
        offered: Number(row.offered) === 1,
      }));
    },

    /**
     * Read-only mirror for the OptionsPage — list of properties that have this option as
     * default, with the offered flag and the property name (joined for display).
     */
    listForOption(optionId) {
      return listForOptionStmt.all(Number(optionId)).map((row) => ({
        propertyId: Number(row.propertyId),
        propertyName: row.propertyName || '',
        offered: Number(row.offered) === 1,
      }));
    },
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
