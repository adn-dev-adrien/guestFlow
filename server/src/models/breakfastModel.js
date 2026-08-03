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
 * Person count (rule 5): the number of people served EACH morning — babies excluded,
 * same convention as the bathroom-linen aggregator. Two regimes, because
 * `reservation_options.quantity` does not mean the same thing on both sides:
 *   - **occurrence-driven option** (`options.showsPlanningCard = 1`, the case since
 *     specs/breakfast-option-planning-card.md): the pricing engine stores
 *     `quantity = number of selected mornings` and `billedUnits = mornings × persons`
 *     ([pricing.js](../utils/pricing.js) `showsPlanningCard` branch). The head count is
 *     therefore the party ITSELF — multiplying by `quantity` would bill/serve
 *     `persons × nights` people every morning (2 guests × 2 nights → « 4 personnes »).
 *   - **legacy / property-default option**: `quantity` is Adrien's sub-occupation factor
 *     (e.g. `0.6667` = 2 of 3 want breakfast), so the count is `ROUND(persons × qtySum)`.
 *     The property-default fallback injects `qtySum = 1.0` (the whole eligible party).
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

// Parse the breakfast option's stored cardOccurrences (JSON array of { date, time, done }) into a
// clean [{ date, time }] list (valid ISO dates only), time-sorted. Empty when none/invalid.
function parseBreakfastOccurrences(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .map((o) => ({ date: String(o?.date || '').slice(0, 10), time: formatTimeShort(o?.time) || '', done: Boolean(o?.done) }))
    .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date))
    .sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.date.localeCompare(b.date));
}

function buildModel(database) {
  // Breakfast now carries the generic per-day occurrence selection (specs/breakfast-option-planning-
  // card.md): when the reservation's breakfast option has `cardOccurrences`, the card is driven by the
  // CHECKED days × their hour (not the automatic morning window). Guarded so minimal test schemas
  // without the column fall back to the window. The subquery picks the breakfast option's stored
  // occurrences for the reservation.
  const HAS_CARD_OCCURRENCES = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_options)').all().some((c) => c.name === 'cardOccurrences'); }
    catch { return false; }
  })();
  const occSelect = HAS_CARD_OCCURRENCES
    ? `, (SELECT ro3.cardOccurrences FROM reservation_options ro3 JOIN options o3 ON o3.id = ro3.optionId
         WHERE ro3.reservationId = res.id AND o3.autoOptionType = 'breakfast'
           AND ro3.cardOccurrences IS NOT NULL AND TRIM(ro3.cardOccurrences) != '' LIMIT 1) AS breakfastCardOccurrences`
    : ', NULL AS breakfastCardOccurrences';

  // Is the breakfast option occurrence-driven? Decides how `quantity` must be read (see the head
  // comment, rule 5). Guarded so a minimal test schema without the column reads as legacy.
  const HAS_SHOWS_PLANNING_CARD = (() => {
    try { return database.prepare('PRAGMA table_info(options)').all().some((c) => c.name === 'showsPlanningCard'); }
    catch { return false; }
  })();
  const cardDrivenExpr = HAS_SHOWS_PLANNING_CARD ? 'COALESCE(o.showsPlanningCard, 0)' : '0';

  // Eligibility sub-query, shared by the windowed and the single-reservation statements: source 1 =
  // explicit reservation_options entry, source 2 = property default fallback when no explicit row
  // exists. `qtySum` collapses to the explicit value when present (source 2 is suppressed by NOT
  // EXISTS) and to 1.0 otherwise; `cardDriven` flags the occurrence-driven regime (never set by the
  // property-default fallback, which has no scheduled mornings).
  const eligibilitySubQuery = `
    SELECT reservationId, SUM(qtySum) AS qtySum, MAX(cardDriven) AS cardDriven
    FROM (
      SELECT ro.reservationId,
             COALESCE(ro.quantity, 0) AS qtySum,
             ${cardDrivenExpr} AS cardDriven
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
       WHERE o.autoOptionType = 'breakfast'

      UNION ALL

      SELECT res2.id AS reservationId,
             1.0 AS qtySum,
             0 AS cardDriven
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
    GROUP BY reservationId`;

  // People served EACH morning (rule 5). `quantity` is a morning COUNT on an occurrence-driven
  // option and a sub-occupation FACTOR on a legacy one — only the latter multiplies the party.
  function morningPersons(row) {
    const personsBase = (Number(row.adults) || 0) + (Number(row.teens) || 0) + (Number(row.children) || 0);
    if (Number(row.cardDriven || 0) === 1) return Math.max(0, personsBase);
    return Math.max(0, Math.round(personsBase * (Number(row.qtySum) || 0)));
  }

  // Eligible reservations in (or overlapping with) the [from, to] window. Same UNION ALL
  // shape as `laundryModel.sumBathroomStmt` — see `eligibilitySubQuery` above.
  const stmt = database.prepare(`
    SELECT
      res.id AS reservationId,
      res.startDate, res.endDate,
      res.adults, res.teens, res.children,
      COALESCE(cli.firstName, '') AS firstName,
      COALESCE(cli.lastName,  '') AS lastName,
      COALESCE(prop.name, '') AS propertyName,
      res.breakfastTime AS reservationBreakfastTime,
      res.breakfastCoffee AS coffee,
      res.breakfastTea AS tea,
      res.breakfastChocolate AS chocolate,
      res.breakfastMilk AS milk,
      res.breakfastPastries AS pastries,
      res.breakfastCereals AS cereals,
      res.breakfastBread AS bread,
      res.breakfastNotifiedDate AS notifiedDate,
      res.breakfastNote AS note,
      sub.qtySum AS qtySum,
      sub.cardDriven AS cardDriven
      ${occSelect}
    FROM reservations res
    JOIN (${eligibilitySubQuery}
    ) sub ON sub.reservationId = res.id
    LEFT JOIN clients   cli  ON cli.id  = res.clientId
    LEFT JOIN properties prop ON prop.id = res.propertyId
    WHERE res.kind = 'reservation'
      AND res.startDate < ?   -- to:   exclude reservations starting after the window
      AND res.endDate   >= ?  -- from: departure-day morning included (rule 4: breakfast is served
                              -- on endDate). Was a strict '>' — a from=to=endDate window (breakfast
                              -- push runner, prep-popup deep-link) silently dropped the item.
  `);

  // Single-reservation variant of `stmt` (no date window) — drives the breakfast SAS page.
  // INNER JOIN on the eligibility sub-query: no row ⇒ breakfast not applicable to this reservation.
  const forReservationStmt = database.prepare(`
    SELECT
      res.id AS reservationId,
      res.adults, res.teens, res.children,
      res.breakfastTime AS reservationBreakfastTime,
      res.breakfastCoffee AS coffee,
      res.breakfastTea AS tea,
      res.breakfastChocolate AS chocolate,
      res.breakfastMilk AS milk,
      res.breakfastPastries AS pastries,
      res.breakfastCereals AS cereals,
      res.breakfastBread AS bread,
      res.arrivalSasDoneAt AS arrivalSasDoneAt,
      res.breakfastNote AS note,
      sub.qtySum AS qtySum,
      sub.cardDriven AS cardDriven
      ${occSelect}
    FROM reservations res
    JOIN (${eligibilitySubQuery}
    ) sub ON sub.reservationId = res.id
    WHERE res.id = ? AND res.kind = 'reservation'
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

  // Effective default breakfast hour (option default, else hard fallback). Resolved on demand.
  function resolveOptionDefaultTime() {
    const optionDefaultRow = optionDefaultStmt ? optionDefaultStmt.get() : null;
    return (optionDefaultRow && formatTimeShort(optionDefaultRow.breakfastTime)) || FALLBACK_BREAKFAST_TIME;
  }

  return {
    /**
     * Breakfast state for the arrival SAS breakfast page. Returns
     * `{ applicable, persons, time, coffee, tea, chocolate, milk, pastries, cereals, bread, note }`.
     * `applicable` is false when the reservation has no breakfast option (explicit or via property
     * default) — the SAS then skips the breakfast page. `persons` is the same resolved morning count
     * shown on the planning card; `time` is the effective hour (reservation override → option default
     * → fallback). Counts/note are the stored values, EXCEPT while the arrival SAS has never been
     * committed: pastries then default to `persons` and bread to `persons × 0.5` (half baguette per
     * person — specs/sas-breakfast-bread-and-push.md rule 3). An explicit post-commit 0 stays 0.
     */
    getForReservation(reservationId) {
      const r = forReservationStmt.get(Number(reservationId));
      if (!r) return { applicable: false, persons: 0, time: resolveOptionDefaultTime(), coffee: 0, tea: 0, chocolate: 0, milk: 0, pastries: 0, cereals: 0, bread: 0, note: '' };
      const persons = morningPersons(r);
      // Hour: the first selected occurrence wins (specs/breakfast-option-planning-card.md §6), else the
      // per-reservation breakfast hour, else the option default.
      const firstOcc = parseBreakfastOccurrences(r.breakfastCardOccurrences)[0];
      const time = (firstOcc && firstOcc.time)
        || formatTimeShort(r.reservationBreakfastTime) || resolveOptionDefaultTime();
      const neverCommitted = !r.arrivalSasDoneAt;
      return {
        applicable: true,
        persons,
        time,
        coffee: Math.max(0, Number(r.coffee) || 0),
        tea: Math.max(0, Number(r.tea) || 0),
        chocolate: Math.max(0, Number(r.chocolate) || 0),
        milk: Math.max(0, Number(r.milk) || 0),
        pastries: neverCommitted ? persons : Math.max(0, Number(r.pastries) || 0),
        cereals: Math.max(0, Number(r.cereals) || 0),
        bread: neverCommitted ? persons * 0.5 : Math.max(0, Number(r.bread) || 0),
        note: (r.note && String(r.note).trim()) || '',
      };
    },

    // Push notice: minutes before the serving time (specs/sas-breakfast-bread-and-push.md rule 7),
    // configured on the breakfast option, clamped to [0, 240], default 30. Guarded so minimal test
    // schemas without the column keep working.
    notifyLeadMinutes() {
      try {
        const row = database.prepare(
          "SELECT breakfastNotifyLeadMinutes AS lead FROM options WHERE autoOptionType = 'breakfast' ORDER BY id LIMIT 1"
        ).get();
        const n = Number(row && row.lead);
        if (!Number.isFinite(n)) return 30;
        return Math.min(240, Math.max(0, Math.round(n)));
      } catch {
        return 30;
      }
    },

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

      // The breakfast option id, so the planning card can drive the « fait » toggle through the
      // generic occurrence endpoint (specs/breakfast-option-planning-card.md). One typed row (seed).
      let breakfastOptionId = null;
      try { const o = database.prepare("SELECT id FROM options WHERE autoOptionType = 'breakfast' ORDER BY id LIMIT 1").get(); breakfastOptionId = o ? o.id : null; } catch { breakfastOptionId = null; }

      const rows = stmt.all(String(to), String(from));
      const result = {};
      for (const r of rows) {
        const persons = morningPersons(r);
        if (persons <= 0) continue;
        const name  = `${r.firstName || ''} ${r.lastName || ''}`.trim();
        const clientName = name || `Réservation #${r.reservationId}`;
        const pushCard = (date, time, done) => {
          if (!result[date]) result[date] = { items: [], totalPersons: 0 };
          result[date].items.push({
            reservationId: r.reservationId,
            optionId: breakfastOptionId,
            date,
            done: Boolean(done),
            clientName,
            propertyName: r.propertyName || '',
            persons,
            breakfastTime: time,
            coffee: Math.max(0, Number(r.coffee) || 0),
            tea: Math.max(0, Number(r.tea) || 0),
            chocolate: Math.max(0, Number(r.chocolate) || 0),
            milk: Math.max(0, Number(r.milk) || 0),
            pastries: Math.max(0, Number(r.pastries) || 0),
            cereals: Math.max(0, Number(r.cereals) || 0),
            bread: Math.max(0, Number(r.bread) || 0),
            // Last notified day — feeds the breakfast push runner's per-day guard.
            notifiedDate: (r.notifiedDate && String(r.notifiedDate).trim()) || null,
            note: (r.note && String(r.note).trim()) || '',
          });
          result[date].totalPersons += persons;
        };

        const occurrences = parseBreakfastOccurrences(r.breakfastCardOccurrences);
        if (occurrences.length > 0) {
          // Per-day selection (specs/breakfast-option-planning-card.md §4): one card per CHECKED
          // occurrence whose date ∈ window, at the occurrence's chosen hour.
          for (const o of occurrences) {
            if (o.date < String(from) || o.date > String(to)) continue;
            pushCard(o.date, o.time || optionDefaultTime, o.done);
          }
        } else {
          // Fallback (no occurrences yet — legacy / not migrated): every served morning at the
          // reservation's breakfast hour, D ∈ (startDate, endDate] clamped to [from, to].
          const breakfastTime = formatTimeShort(r.reservationBreakfastTime) || optionDefaultTime;
          let cursor = isoMax(addDays(String(r.startDate), 1), String(from));
          const cap   = isoMin(String(r.endDate), String(to));
          while (cursor <= cap) { pushCard(cursor, breakfastTime, false); cursor = addDays(cursor, 1); }
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
