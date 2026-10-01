/**
 * Laundry trip skips model — sole DB access for `laundry_trip_skips`.
 *
 * A skip is a single ISO date (`YYYY-MM-DD`). Marking a date as skipped tells the linen
 * inventory engine (`linenInventory.js`) NOT to perform the drop-off + pick-up
 * transitions on that day — the dirty linen stays dirty, the at-laundry linen stays at the
 * laundry, and both backlogs flow forward to the next non-skipped laundry day. Global
 * scope by design (spec §3.1 rule 1): one human, one trip per day, the toggle is per-date,
 * not per-property.
 *
 * `create(db)` builds it on a database — the plugin's `ctx.db` in production, an in-memory schema in
 * tests. Built on first use: the table only exists once the plugin is installed.
 *
 * Spec: specs/skip-laundry-trip.md §4.1 + §5.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(date) {
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) {
    throw new Error(`laundryTripSkipsModel: expected ISO date YYYY-MM-DD, got: ${JSON.stringify(date)}`);
  }
}

function createModel(database) {
  const listStmt = database.prepare('SELECT tripDate FROM laundry_trip_skips ORDER BY tripDate ASC');
  const isSkippedStmt = database.prepare('SELECT 1 FROM laundry_trip_skips WHERE tripDate = ?');
  const addStmt = database.prepare('INSERT OR IGNORE INTO laundry_trip_skips (tripDate) VALUES (?)');
  const removeStmt = database.prepare('DELETE FROM laundry_trip_skips WHERE tripDate = ?');
  const countStmt = database.prepare('SELECT COUNT(*) AS c FROM laundry_trip_skips');

  return {
    /** Returns every skipped date, sorted ASC. */
    listAll() {
      return listStmt.all().map((r) => r.tripDate);
    },

    /** Predicate — is `date` (YYYY-MM-DD) currently flagged as skipped? */
    isSkipped(date) {
      assertIsoDate(date);
      return Boolean(isSkippedStmt.get(date));
    },

    /** Idempotent insert. Returns true if the row was created, false if already present. */
    add(date) {
      assertIsoDate(date);
      const result = addStmt.run(date);
      return result.changes > 0;
    },

    /** Idempotent delete. Returns true if a row was removed, false if it wasn't there. */
    remove(date) {
      assertIsoDate(date);
      const result = removeStmt.run(date);
      return result.changes > 0;
    },

    /** Test-friendly accessor. */
    count() {
      return countStmt.get().c;
    },
  };
}

module.exports = { create: createModel };
