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
  // specs/laundry-counts-explicit-option-only.md §3.1 rules 3-5 — a VISIBLE option only counts when
  // it is actually ticked on the reservation; the property default no longer creates a contract for
  // it. INTERNAL options (`displayToClient = 0`) are the exception: `reservationsModel.insertOptions`
  // and the iCal import both refuse to persist them (specs/laundry-bath-mat.md §3 rule 11), so the
  // property default is their only possible source. The predicate below is spliced into source 2 of
  // each UNION; on a schema without the column every option reads as visible → explicit-row-only.
  const HAS_DISPLAY_TO_CLIENT = (() => {
    try { return database.prepare('PRAGMA table_info(options)').all().some((c) => c.name === 'displayToClient'); }
    catch { return false; }
  })();
  const INTERNAL_ONLY = HAS_DISPLAY_TO_CLIENT ? 'AND o.displayToClient = 0' : 'AND 1 = 0';

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
  //
  // §3.7 follow-up (2026-06-03), NARROWED 2026-08-11
  // (specs/laundry-counts-explicit-option-only.md §3.1): the property-default sub-source now only
  // applies to INTERNAL options. A visible option the operator did not tick means "this stay has no
  // linen" — bed linen only became mandatory on the lodge in June 2026, so the default cannot be
  // read as a retroactive contract. `NOT EXISTS` still makes source 2 a strict FALLBACK: an explicit
  // row, if any, wins (its `linenIncludes*` flags are honoured even when they differ from the
  // option's globals, which is the realistic case since the option is shared across all properties).
  const sumStmt = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN sub.includesSingle = 1 THEN COALESCE(r.singleBeds, 0) ELSE 0 END), 0) AS singleBeds,
      COALESCE(SUM(CASE WHEN sub.includesDouble = 1 THEN COALESCE(r.doubleBeds, 0) ELSE 0 END), 0) AS doubleBeds,
      COALESCE(SUM(CASE WHEN sub.includesBaby   = 1 THEN COALESCE(r.babyBeds,   0) ELSE 0 END), 0) AS babyBeds
    FROM reservations r
    JOIN (
      SELECT reservationId,
        MAX(includesSingle) AS includesSingle,
        MAX(includesDouble) AS includesDouble,
        MAX(includesBaby)   AS includesBaby
      FROM (
        -- Source 1: explicit reservation_options row linking to a linen-flagged option.
        SELECT ro.reservationId,
          o.linenIncludesSingle AS includesSingle,
          o.linenIncludesDouble AS includesDouble,
          o.linenIncludesBaby   AS includesBaby
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        WHERE o.countsAsBedLinen = 1

        UNION ALL

        -- Source 2: property-level default, INTERNAL options only — those can never appear in
        -- reservation_options, so the default is their sole source. Fallback ONLY: skipped when
        -- the reservation already has an explicit row (source 1 wins).
        SELECT res.id AS reservationId,
          o.linenIncludesSingle, o.linenIncludesDouble, o.linenIncludesBaby
        FROM reservations res
        JOIN property_option_defaults pod ON pod.propertyId = res.propertyId
        JOIN options o ON o.id = pod.optionId
        WHERE o.countsAsBedLinen = 1
          ${INTERNAL_ONLY}
          AND NOT EXISTS (
            SELECT 1 FROM reservation_options ro2
            JOIN options o2 ON o2.id = ro2.optionId
            WHERE ro2.reservationId = res.id AND o2.countsAsBedLinen = 1
          )
      ) sources
      GROUP BY reservationId
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
  //
  // §3.7 follow-up (2026-06-03), NARROWED 2026-08-11: same UNION ALL pattern as the bed-linen path,
  // and the same narrowing — source 2 (the property-default fallback, qtySum 1.0 = "the whole party
  // gets towels") is restricted to INTERNAL options. Bath linen is an extra sold at arrival: not
  // ticked means not provided, so a visible default must not conjure towels. When the operator
  // explicitly entered a quantity (typically 0.6667 = "2 of 3 want towels" — Adrien's sub-occupation
  // factor) the explicit row wins and the default is suppressed by `NOT EXISTS`.
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
      SELECT reservationId,
        SUM(qtySum)         AS qtySum,
        MAX(largePerPerson) AS largePerPerson,
        MAX(mediumPerPerson) AS mediumPerPerson,
        MAX(smallPerPerson)  AS smallPerPerson
      FROM (
        -- Source 1: explicit reservation_options row.
        SELECT ro.reservationId,
          COALESCE(ro.quantity, 0) AS qtySum,
          o.towelLargePerPerson    AS largePerPerson,
          o.towelMediumPerPerson   AS mediumPerPerson,
          o.towelSmallPerPerson    AS smallPerPerson
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        WHERE o.countsAsBathroomLinen = 1

        UNION ALL

        -- Source 2: property-level default fallback, INTERNAL options only. qty = 1.0 (whole party).
        SELECT res.id AS reservationId,
          1.0 AS qtySum,
          o.towelLargePerPerson, o.towelMediumPerPerson, o.towelSmallPerPerson
        FROM reservations res
        JOIN property_option_defaults pod ON pod.propertyId = res.propertyId
        JOIN options o ON o.id = pod.optionId
        WHERE o.countsAsBathroomLinen = 1
          ${INTERNAL_ONLY}
          AND NOT EXISTS (
            SELECT 1 FROM reservation_options ro2
            JOIN options o2 ON o2.id = ro2.optionId
            WHERE ro2.reservationId = res.id AND o2.countsAsBathroomLinen = 1
          )
      ) sources
      GROUP BY reservationId
    ) sub ON sub.reservationId = r.id
    WHERE r.kind = 'reservation'
      AND r.endDate > ?
      AND r.endDate <= ?
  `);

  // 2026-06-24 — bath-mat variant (specs/laundry-bath-mat.md §3 rule 8). A reservation contributes
  // its PROPERTY's bath-mat quantity (flat per stay, not per person) iff the "Tapis de bain" option
  // is active on it — explicit reservation_options row OR property-default fallback. Same UNION ALL /
  // NOT EXISTS pattern as the bathroom path; the per-reservation value is the property quantity from
  // `property_option_bath_mats` (LEFT JOIN → 0 when the property has no quantity). MAX(quantity) per
  // reservation collapses the (theoretical) multi-option case before summing across reservations.
  // Guarded: a schema without the column/table degrades to a zero result instead of throwing.
  const HAS_BATH_MAT_COL = (() => {
    try { return database.prepare('PRAGMA table_info(options)').all().some((c) => c.name === 'countsAsBathMat'); }
    catch { return false; }
  })();
  const HAS_BATH_MAT_TABLE = (() => {
    try { database.prepare('SELECT 1 FROM property_option_bath_mats LIMIT 1').get(); return true; }
    catch { return false; }
  })();
  const sumBathMatStmt = (HAS_BATH_MAT_COL && HAS_BATH_MAT_TABLE) ? database.prepare(`
    SELECT COALESCE(SUM(sub.quantity), 0) AS bathMats
    FROM reservations r
    JOIN (
      SELECT reservationId, MAX(quantity) AS quantity
      FROM (
        SELECT ro.reservationId AS reservationId,
          COALESCE(pobm.quantity, 0) AS quantity
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        JOIN reservations res ON res.id = ro.reservationId
        LEFT JOIN property_option_bath_mats pobm
          ON pobm.optionId = o.id AND pobm.propertyId = res.propertyId
        WHERE o.countsAsBathMat = 1

        UNION ALL

        SELECT res.id AS reservationId,
          COALESCE(pobm.quantity, 0) AS quantity
        FROM reservations res
        JOIN property_option_defaults pod ON pod.propertyId = res.propertyId
        JOIN options o ON o.id = pod.optionId
        LEFT JOIN property_option_bath_mats pobm
          ON pobm.optionId = o.id AND pobm.propertyId = res.propertyId
        WHERE o.countsAsBathMat = 1
          AND NOT EXISTS (
            SELECT 1 FROM reservation_options ro2
            JOIN options o2 ON o2.id = ro2.optionId
            WHERE ro2.reservationId = res.id AND o2.countsAsBathMat = 1
          )
      ) sources
      GROUP BY reservationId
    ) sub ON sub.reservationId = r.id
    WHERE r.kind = 'reservation'
      AND r.endDate > ?
      AND r.endDate <= ?
  `) : null;

  // specs/laundry-counts-explicit-option-only.md §3.2 rule 7 — now that the ticked option is the
  // only signal, a stay that carries it but has no quantity yet would contribute a silent zero.
  // List those so the card can admit its figure is short instead of under-reporting quietly. Only
  // the EXPLICIT source matters here: an internal option counted through the property default has
  // no operator-facing quantity to fill in. The `properties` / `clients` joins are pure label
  // enrichment, so a minimal schema missing either table drops that join instead of the feature.
  const hasTable = (name) => {
    try { database.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get(); return true; }
    catch { return false; }
  };
  const HAS_PROPERTIES = hasTable('properties');
  const HAS_CLIENTS = hasTable('clients');
  const incompleteBedConfigStmt = database.prepare(`
    SELECT r.id, r.endDate,
      ${HAS_PROPERTIES ? 'p.name AS propertyName' : "'' AS propertyName"},
      ${HAS_CLIENTS ? 'c.firstName, c.lastName' : "'' AS firstName, '' AS lastName"}
    FROM reservations r
    ${HAS_PROPERTIES ? 'LEFT JOIN properties p ON p.id = r.propertyId' : ''}
    ${HAS_CLIENTS ? 'LEFT JOIN clients c ON c.id = r.clientId' : ''}
    WHERE r.kind = 'reservation'
      AND r.endDate > ?
      AND r.endDate <= ?
      AND COALESCE(r.singleBeds, 0) + COALESCE(r.doubleBeds, 0) + COALESCE(r.babyBeds, 0) = 0
      AND EXISTS (
        SELECT 1 FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        WHERE ro.reservationId = r.id AND o.countsAsBedLinen = 1
      )
    ORDER BY r.endDate, r.id
  `);

  return {
    /**
     * Reservations of the window that declare bed linen but carry no bed quantity yet
     * (specs/laundry-counts-explicit-option-only.md §3.2). Returns
     * `[{ id, clientName, propertyName, endDate }]`, empty when the week is complete.
     * `clientName` falls back to `#<id>` when the client row is gone.
     */
    incompleteBedConfigForWindow(startExclusiveIso, endInclusiveIso) {
      return incompleteBedConfigStmt.all(String(startExclusiveIso), String(endInclusiveIso)).map((row) => ({
        id: Number(row.id),
        clientName: `${row.firstName || ''} ${row.lastName || ''}`.trim() || `#${row.id}`,
        propertyName: row.propertyName || '',
        endDate: row.endDate || '',
      }));
    },

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

    /**
     * Sum the bath-mat demand for reservations whose endDate is in
     * `(startExclusiveIso, endInclusiveIso]` and that have an active "Tapis de bain" option
     * (explicit selection OR property default). Per-reservation contribution = the reservation's
     * property bath-mat quantity (flat per stay). Returns `{ bathMats }`, zero when the feature's
     * column/table is absent (minimal schemas) — see `sumBathMatStmt`.
     */
    dropOffBathMatForWindow(startExclusiveIso, endInclusiveIso) {
      if (!sumBathMatStmt) return { bathMats: 0 };
      const row = sumBathMatStmt.get(String(startExclusiveIso), String(endInclusiveIso));
      return { bathMats: Number(row.bathMats) || 0 };
    },
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
