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

  // 2026-06-02 — bathroom-linen variant (specs §3.5.bis). Asymmetric with the bed-linen path:
  // the towel option is `priceType = per_person` and Adrien uses the `reservation_options.quantity`
  // field as a sub-occupation scaler (e.g. qty = 0.6667 on a 3-person reservation = "only 2 of
  // the 3 persons want towels"). So each reservation's contribution is
  //   (adults + teens + children) × SUM(reservation_options.quantity over bathroom-flagged options)
  // Babies excluded (no adult-sized towel pair). Per-reservation result is ROUND'ed (towels are
  // whole physical objects); SUM across reservations is then itself an integer-friendly REAL.
  //
  // The inner subquery aggregates quantity per reservation BEFORE joining, which keeps the EXISTS
  // semantics (no row multiplication when a reservation carries two bathroom-flagged options —
  // their quantities are summed in the subquery instead of duplicating the parent row).
  const sumBathroomStmt = database.prepare(`
    SELECT
      COALESCE(SUM(
        ROUND(
          (COALESCE(r.adults, 0) + COALESCE(r.teens, 0) + COALESCE(r.children, 0))
          * sub.qtySum
        )
      ), 0) AS personCount
    FROM reservations r
    JOIN (
      SELECT ro.reservationId, SUM(COALESCE(ro.quantity, 0)) AS qtySum
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
       WHERE o.countsAsBathroomLinen = 1
       GROUP BY ro.reservationId
    ) sub ON sub.reservationId = r.id
    WHERE r.kind = 'reservation'
      AND r.endDate > ?
      AND r.endDate <= ?
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

    /**
     * Sum the towel demand for reservations whose endDate is in
     * `(startExclusiveIso, endInclusiveIso]` and that have ≥1 bathroom-flagged option.
     *
     * Per-reservation contribution = ROUND((adults + teens + children) ×
     * SUM(reservation_options.quantity over bathroom-flagged options)). Babies excluded.
     * The quantity field is the operator's per-reservation sub-occupation factor (e.g. 0.6667
     * on a 3-person stay = "2 persons want towels"). 1 large + 1 small towel per effective
     * person — exposed as two equal keys because the laundry batch is sorted/billed by towel
     * TYPE, not by aggregate.
     */
    dropOffBathroomForWindow(startExclusiveIso, endInclusiveIso) {
      const row = sumBathroomStmt.get(String(startExclusiveIso), String(endInclusiveIso));
      const persons = Number(row.personCount) || 0;
      return { largeTowels: persons, smallTowels: persons };
    },
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
