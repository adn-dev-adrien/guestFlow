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
  // A default implies the option is APPLICABLE to the property: every options code path (the
  // reservation form's client filter, the pricing engine, the public catalog) keys off
  // `property_options`. Keep them in sync on write so a newly-set default renders + prices on the
  // reservation page immediately (specs/property-default-option-applicability.md). Guarded for
  // minimal test schemas that lack the table.
  let ensureApplicableStmt = null;
  try { ensureApplicableStmt = database.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)'); }
  catch { ensureApplicableStmt = null; }
  // Defaults to auto-add on a NEW reservation. Two families are deliberately excluded — they are
  // rows a reservation can never actually carry, and listing them puts a phantom line on the fiche
  // that is displayed, priced at 0 and then silently dropped at save:
  //   - ARCHIVED options: withdrawn from the catalogue, so never sellable again;
  //   - INTERNAL linen options (`displayToClient = 0`, e.g. « Tapis de bain »): skipped by
  //     `reservationsModel.insertOptions` by construction (specs/laundry-bath-mat.md §3 rule 11).
  //     The laundry counters read `property_option_defaults` directly in SQL, so hiding them here
  //     costs them nothing.
  // Built defensively: a minimal test schema without those columns falls back to the bare list.
  const optionColumns = (() => {
    try { return new Set(database.prepare('PRAGMA table_info(options)').all().map((c) => c.name)); }
    catch { return new Set(); }
  })();
  const hasOptionsTable = optionColumns.size > 0;
  const billableFilter = [
    optionColumns.has('archivedAt') ? 'o.archivedAt IS NULL' : null,
    optionColumns.has('displayToClient') ? 'COALESCE(o.displayToClient, 1) != 0' : null,
  ].filter(Boolean).join(' AND ');
  const listForPropertyStmt = database.prepare(
    hasOptionsTable && billableFilter
      ? `SELECT d.optionId, d.offered
           FROM property_option_defaults d
           JOIN options o ON o.id = d.optionId
          WHERE d.propertyId = ? AND ${billableFilter}
          ORDER BY d.optionId`
      : `SELECT optionId, offered
           FROM property_option_defaults
          WHERE propertyId = ?
          ORDER BY optionId`
  );
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
      if (ensureApplicableStmt) ensureApplicableStmt.run(pid, oid);
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
