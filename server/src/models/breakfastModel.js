/**
 * Breakfast model — per-day breakfast aggregation for the Planning page.
 * Spec: specs/breakfast-option-and-planning-card.md §3-§4.
 *
 * Returns a `{ 'YYYY-MM-DD': { items: [{ reservationId, clientName, propertyName,
 * persons }], totalPersons } }` map.
 *
 * Eligibility, per rule 3:
 *   - The reservation has at least one `reservation_options` row linking to an option
 *     flagged `autoOptionType = 'breakfast'` AND its `quantity > 0`, OR
 *   - The reservation's property declares a `breakfast`-typed option as a default in
 *     `property_option_defaults` AND the reservation has NO explicit row for any
 *     `breakfast`-typed option (= the property fallback only kicks in when the operator
 *     hasn't expressed an explicit choice).
 *
 * Per-day inclusion rule (rule 4): breakfast is served on date D when the customer
 * slept the night `D-1 → D`, i.e. `startDate < D AND endDate >= D`. The morning of
 * `startDate` is excluded (the customer hasn't arrived yet), the morning of `endDate`
 * is included (still there for breakfast before checking out).
 *
 * Person count (rule 5): `ROUND((adults + teens + children) × Σ qtySum)`. Babies
 * excluded — same convention as the bathroom-linen aggregator. `qtySum` is the SUM
 * over all the `breakfast`-typed options on the reservation (sub-occupation factor:
 * e.g. `quantity = 0.6667` = 2 of 3 want breakfast). The property-default fallback
 * injects `qtySum = 1.0` (the whole eligible party).
 *
 * Implementation: a single SQL fetches all eligible reservations overlapping with
 * `[from, to]`; JS then enumerates the breakfast dates `(startDate, endDate]` clamped
 * to the requested window. Single-pass query is cheap on a SQLite Pi (no JOIN
 * explosion on dates).
 *
 * Mirrors the factory pattern of `laundryModel.js`.
 */

const { addDays } = require('../utils/laundryWindow');
const { formatTimeShort } = require('../utils/dateFr');

// Last-resort breakfast time when neither the reservation nor the option carries one
// (specs/breakfast-time.md). The option column defaults to '09:00', so this rarely triggers.
const FALLBACK_BREAKFAST_TIME = '09:00';

// Two-line ISO string comparators co-located here (lexicographic compare on the
// `YYYY-MM-DD` shape is correct date order). Not worth promoting into `laundryWindow`
// for a single consumer.
function isoMax(a, b) { return a > b ? a : b; }
function isoMin(a, b) { return a < b ? a : b; }

function buildModel(database) {
  // Eligible reservations in (or overlapping with) the [from, to] window. Same UNION ALL
  // shape as `laundryModel.sumBathroomStmt`: source 1 = explicit reservation_options
  // entry; source 2 = property default fallback when no explicit row exists. The
  // resulting `qtySum` is the SUM over both sources, which collapses to the explicit
  // value when present (source 2 is suppressed by NOT EXISTS) and to 1.0 otherwise.
  const stmt = database.prepare(`
    SELECT
      res.id AS reservationId,
      res.startDate, res.endDate,
      res.adults, res.teens, res.children,
      COALESCE(cli.firstName, '') AS firstName,
      COALESCE(cli.lastName,  '') AS lastName,
      COALESCE(prop.name, '') AS propertyName,
      res.breakfastTime AS reservationBreakfastTime,
      sub.qtySum AS qtySum
    FROM reservations res
    JOIN (
      SELECT reservationId, SUM(qtySum) AS qtySum
      FROM (
        -- Source 1: explicit reservation_options entry on a breakfast-typed option.
        SELECT ro.reservationId,
               COALESCE(ro.quantity, 0) AS qtySum
          FROM reservation_options ro
          JOIN options o ON o.id = ro.optionId
         WHERE o.autoOptionType = 'breakfast'

        UNION ALL

        -- Source 2: property default fallback. Kicks in only when the reservation has
        -- NO explicit row for any breakfast-typed option. qty = 1.0 (whole party).
        SELECT res2.id AS reservationId,
               1.0 AS qtySum
          FROM reservations res2
          JOIN property_option_defaults pod ON pod.propertyId = res2.propertyId
          JOIN options o ON o.id = pod.optionId
         WHERE o.autoOptionType = 'breakfast'
           AND NOT EXISTS (
             SELECT 1 FROM reservation_options ro2
             JOIN options o2 ON o2.id = ro2.optionId
             WHERE ro2.reservationId = res2.id
               AND o2.autoOptionType = 'breakfast'
           )
      ) sources
      GROUP BY reservationId
    ) sub ON sub.reservationId = res.id
    LEFT JOIN clients   cli  ON cli.id  = res.clientId
    LEFT JOIN properties prop ON prop.id = res.propertyId
    WHERE res.kind = 'reservation'
      AND res.startDate < ?   -- to:   exclude reservations starting after the window
      AND res.endDate   > ?   -- from: exclude reservations already over at window start
  `);

  // Default breakfast hour carried by the (single, typed) breakfast option. Guarded so minimal
  // test schemas without the `breakfastTime` column simply fall back to FALLBACK_BREAKFAST_TIME.
  const optionDefaultStmt = (() => {
    try {
      return database.prepare(
        "SELECT breakfastTime FROM options WHERE autoOptionType = 'breakfast' AND breakfastTime IS NOT NULL AND TRIM(breakfastTime) != '' ORDER BY id LIMIT 1",
      );
    } catch { return null; }
  })();

  return {
    /**
     * Returns `{ 'YYYY-MM-DD': { items: [{ reservationId, clientName, propertyName,
     * persons }], totalPersons } }` for every breakfast day in `[from, to]`. Empty
     * object when no reservation contributes.
     */
    breakfastByDate({ from, to }) {
      // Effective default time = the breakfast option's configured hour, else the hard fallback
      // (specs/breakfast-time.md rule 4). Resolved once per call.
      const optionDefaultRow = optionDefaultStmt ? optionDefaultStmt.get() : null;
      const optionDefaultTime = (optionDefaultRow && formatTimeShort(optionDefaultRow.breakfastTime))
        || FALLBACK_BREAKFAST_TIME;

      const rows = stmt.all(String(to), String(from));
      const result = {};
      for (const r of rows) {
        const personsBase = (Number(r.adults) || 0)
                          + (Number(r.teens)  || 0)
                          + (Number(r.children) || 0);
        const persons = Math.round(personsBase * (Number(r.qtySum) || 0));
        if (persons <= 0) continue;
        // Per-reservation desired time wins; else the option default; else the fallback.
        const breakfastTime = formatTimeShort(r.reservationBreakfastTime) || optionDefaultTime;
        // Breakfast served on D ∈ (startDate, endDate] clamped to [from, to]
        let cursor = isoMax(addDays(String(r.startDate), 1), String(from));
        const cap   = isoMin(String(r.endDate), String(to));
        const name  = `${r.firstName || ''} ${r.lastName || ''}`.trim();
        const clientName = name || `Réservation #${r.reservationId}`;
        while (cursor <= cap) {
          if (!result[cursor]) result[cursor] = { items: [], totalPersons: 0 };
          result[cursor].items.push({
            reservationId: r.reservationId,
            clientName,
            propertyName: r.propertyName || '',
            persons,
            breakfastTime,
          });
          result[cursor].totalPersons += persons;
          cursor = addDays(cursor, 1);
        }
      }
      // Sort each day's breakfasts by time (earliest first), tie-break by client name then id —
      // deterministic ordering for the planning card (specs/breakfast-time.md rule 6).
      for (const date of Object.keys(result)) {
        result[date].items.sort((a, b) =>
          (a.breakfastTime || '').localeCompare(b.breakfastTime || '')
          || a.clientName.localeCompare(b.clientName, 'fr')
          || a.reservationId - b.reservationId);
      }
      return result;
    },
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
