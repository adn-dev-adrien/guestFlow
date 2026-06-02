/**
 * Laundry model — weekly bed-linen aggregation for the Planning page
 * (specs/weekly-bed-linen-tracking.md).
 *
 * Exposes a single pure-SQL aggregator that sums single / double / baby bed counts across
 * every confirmed reservation whose `endDate` falls in a half-open window `(start, end]` AND
 * whose options include at least one row flagged `countsAsBedLinen = 1`. The half-open
 * boundary matches §3.3 rule 8: a check-out exactly on the laundry day joins that day's
 * batch, but a check-out exactly on the previous laundry day belongs to the previous batch.
 *
 * Why DISTINCT in the aggregation: a reservation may carry several linen-flagged options
 * (Adrien might have a "Linge de lit Standard" + "Linge de lit Premium" variant) — joining
 * `reservation_options` × `options` would otherwise multiply the bed counts by the number
 * of matching option rows. The inner correlated EXISTS avoids the row multiplication while
 * still letting us filter by "at least one linen-flagged option".
 *
 * Factory pattern (`buildModel(db)`) mirrors usersModel / settingsModel — keeps unit tests
 * decoupled from the production DB.
 */

function buildModel(database) {
  // Sum singleBeds / doubleBeds / babyBeds across reservations that:
  //   - have kind = 'reservation' (devis excluded — matches every other aggregation in the app)
  //   - have endDate in the half-open window (start, end]   (rule 8)
  //   - have at least one reservation_options row linking to an option with countsAsBedLinen = 1
  //
  // COALESCE on the bed counts because the reservations table allows NULL on those columns
  // (legacy rows imported from iCal). NULL → 0 → no contribution, no crash.
  const sumStmt = database.prepare(`
    SELECT
      COALESCE(SUM(COALESCE(r.singleBeds, 0)), 0) AS singleBeds,
      COALESCE(SUM(COALESCE(r.doubleBeds, 0)), 0) AS doubleBeds,
      COALESCE(SUM(COALESCE(r.babyBeds, 0)), 0)   AS babyBeds
    FROM reservations r
    WHERE r.kind = 'reservation'
      AND r.endDate > ?
      AND r.endDate <= ?
      AND EXISTS (
        SELECT 1
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        WHERE ro.reservationId = r.id AND o.countsAsBedLinen = 1
      )
  `);

  return {
    /**
     * Sum bed counts for reservations whose endDate is in `(startExclusiveIso, endInclusiveIso]`
     * and that have the linen option. Returns `{ singleBeds, doubleBeds, babyBeds }` (always
     * non-negative integers, zero when nothing matches).
     */
    dropOffForWindow(startExclusiveIso, endInclusiveIso) {
      const row = sumStmt.get(String(startExclusiveIso), String(endInclusiveIso));
      return {
        singleBeds: Number(row.singleBeds) || 0,
        doubleBeds: Number(row.doubleBeds) || 0,
        babyBeds: Number(row.babyBeds) || 0,
      };
    },
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
