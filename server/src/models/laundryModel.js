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
  // §3.5.ter follow-up: each bed-linen option ALSO carries 3 per-type include flags
  // (linenIncludesSingle / Double / Baby). The aggregation gates each bed-type sum on those
  // flags via a JOIN onto a per-reservation aggregate (MAX = "any flagged option that includes
  // this bed type"). COALESCE on the bed counts because the reservations table allows NULL on
  // those columns (legacy rows imported from iCal). NULL → 0 → no contribution, no crash.
  const sumStmt = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN sub.includesSingle = 1 THEN COALESCE(r.singleBeds, 0) ELSE 0 END), 0) AS singleBeds,
      COALESCE(SUM(CASE WHEN sub.includesDouble = 1 THEN COALESCE(r.doubleBeds, 0) ELSE 0 END), 0) AS doubleBeds,
      COALESCE(SUM(CASE WHEN sub.includesBaby   = 1 THEN COALESCE(r.babyBeds,   0) ELSE 0 END), 0) AS babyBeds
    FROM reservations r
    JOIN (
      SELECT ro.reservationId,
        MAX(o.linenIncludesSingle) AS includesSingle,
        MAX(o.linenIncludesDouble) AS includesDouble,
        MAX(o.linenIncludesBaby)   AS includesBaby
      FROM reservation_options ro
      JOIN options o ON o.id = ro.optionId
      WHERE o.countsAsBedLinen = 1
      GROUP BY ro.reservationId
    ) sub ON sub.reservationId = r.id
    WHERE r.kind = 'reservation'
      AND r.endDate > ?
      AND r.endDate <= ?
  `);

  // 2026-06-02 — bathroom-linen variant (specs §3.5.bis + §3.5.ter). Asymmetric with the
  // bed-linen path: the towel option is `priceType = per_person` and Adrien uses the
  // `reservation_options.quantity` field as a sub-occupation scaler (e.g. qty = 0.6667 on a
  // 3-person reservation = "only 2 of the 3 persons want towels"). Each reservation's
  // contribution per towel size:
  //   ROUND((adults + teens + children) × Σ quantity × MAX(perPersonCount))
  // …where `perPersonCount` is the option's `towelLargePerPerson` / `towelMediumPerPerson` /
  // `towelSmallPerPerson` (§3.5.ter). Babies excluded (no adult-sized towel pair). The inner
  // subquery aggregates per reservation BEFORE joining, preventing row multiplication when a
  // reservation carries multiple bathroom-flagged options.
  const sumBathroomStmt = database.prepare(`
    SELECT
      COALESCE(SUM(ROUND(
        (COALESCE(r.adults, 0) + COALESCE(r.teens, 0) + COALESCE(r.children, 0))
        * sub.qtySum * sub.largePerPerson
      )), 0) AS largeTowels,
      COALESCE(SUM(ROUND(
        (COALESCE(r.adults, 0) + COALESCE(r.teens, 0) + COALESCE(r.children, 0))
        * sub.qtySum * sub.mediumPerPerson
      )), 0) AS mediumTowels,
      COALESCE(SUM(ROUND(
        (COALESCE(r.adults, 0) + COALESCE(r.teens, 0) + COALESCE(r.children, 0))
        * sub.qtySum * sub.smallPerPerson
      )), 0) AS smallTowels
    FROM reservations r
    JOIN (
      SELECT ro.reservationId,
        SUM(COALESCE(ro.quantity, 0)) AS qtySum,
        MAX(o.towelLargePerPerson)  AS largePerPerson,
        MAX(o.towelMediumPerPerson) AS mediumPerPerson,
        MAX(o.towelSmallPerPerson)  AS smallPerPerson
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
     * Per-reservation contribution per towel size = ROUND(persons × Σ quantity × perPersonCount),
     * where persons = adults + teens + children (babies excluded), `Σ quantity` is the sum of
     * `reservation_options.quantity` over the bathroom-flagged options on that reservation
     * (sub-occupation factor — §3.5.bis), and `perPersonCount` is the option's
     * `towelLargePerPerson` / `towelMediumPerPerson` / `towelSmallPerPerson` (§3.5.ter; defaults
     * 1 / 0 / 1 preserve legacy semantics). The client filters silent sizes (0) at render time
     * (rule 13.bis).
     */
    dropOffBathroomForWindow(startExclusiveIso, endInclusiveIso) {
      const row = sumBathroomStmt.get(String(startExclusiveIso), String(endInclusiveIso));
      return {
        largeTowels:  Number(row.largeTowels)  || 0,
        mediumTowels: Number(row.mediumTowels) || 0,
        smallTowels:  Number(row.smallTowels)  || 0,
      };
    },
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
