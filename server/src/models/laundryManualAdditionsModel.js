/**
 * Laundry trip manual additions model — sole DB access for `laundry_trip_manual_additions`.
 *
 * A manual line is per laundry trip date (`YYYY-MM-DD`), global (one human, one trip per day —
 * same scope as `laundryTripSkipsModel`). It holds six SIGNED per-type counts:
 *   - positive = linen the operator washes on that trip on top of what the reservations imply. The
 *     planning summary folds it into « À apporter / À récupérer » and the inventory engine washes it
 *     like reservation linen (clean → laundry → clean).
 *   - negative = linen the operator washes HIMSELF, withdrawn from the trip: it leaves « À apporter »,
 *     never returns in « À récupérer », and the engine puts it straight back in the clean stock
 *     (specs/laundry-manual-removals.md).
 *
 * Spec: specs/manual-laundry-additions.md §4.1 + §5, specs/laundry-manual-removals.md §4.1.
 */

const db = require('../database');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['singleBeds', 'doubleBeds', 'babyBeds', 'largeTowels', 'mediumTowels', 'smallTowels'];

function assertIsoDate(date) {
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) {
    throw new Error(`laundryManualAdditionsModel: expected ISO date YYYY-MM-DD, got: ${JSON.stringify(date)}`);
  }
}

function zeros() {
  return { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 };
}

// A SIGNED integer (specs/laundry-manual-removals.md §3 rules 1-2): positive = extra linen to wash on
// this trip, negative = linen the operator washes himself, withdrawn from the trip. Rounding is the
// only authoritative normalisation left — the clamping that matters (never deposit a negative pile,
// never wash more than what is dirty) belongs to the summary and to the inventory engine, which are
// the two places that know what the trip actually holds.
function clampCount(v) {
  return Math.round(Number(v) || 0);
}

function normalize(counts) {
  const out = zeros();
  for (const t of TYPES) out[t] = clampCount(counts && counts[t]);
  return out;
}

function rowToCounts(row) {
  if (!row) return zeros();
  const out = zeros();
  for (const t of TYPES) out[t] = Number(row[t]) || 0;
  return out;
}

function createModel(database) {
  const getStmt = database.prepare(`SELECT ${TYPES.join(', ')} FROM laundry_trip_manual_additions WHERE tripDate = ?`);
  const listStmt = database.prepare(`SELECT tripDate, ${TYPES.join(', ')} FROM laundry_trip_manual_additions ORDER BY tripDate ASC`);
  const upsertStmt = database.prepare(`
    INSERT INTO laundry_trip_manual_additions (tripDate, singleBeds, doubleBeds, babyBeds, largeTowels, mediumTowels, smallTowels, updatedAt)
    VALUES (@tripDate, @singleBeds, @doubleBeds, @babyBeds, @largeTowels, @mediumTowels, @smallTowels, datetime('now'))
    ON CONFLICT(tripDate) DO UPDATE SET
      singleBeds = @singleBeds, doubleBeds = @doubleBeds, babyBeds = @babyBeds,
      largeTowels = @largeTowels, mediumTowels = @mediumTowels, smallTowels = @smallTowels,
      updatedAt = datetime('now')
  `);
  const deleteStmt = database.prepare('DELETE FROM laundry_trip_manual_additions WHERE tripDate = ?');
  // Half-open window (startExclusive, endInclusive] — mirrors laundryModel.dropOffForWindow.
  const sumStmt = database.prepare(`
    SELECT ${TYPES.map((t) => `COALESCE(SUM(${t}), 0) AS ${t}`).join(', ')}
    FROM laundry_trip_manual_additions
    WHERE tripDate > ? AND tripDate <= ?
  `);

  return {
    /** The six per-type counts for `date` (zeros when no row). */
    get(date) {
      assertIsoDate(date);
      return rowToCounts(getStmt.get(date));
    },

    /**
     * Upsert the six counts for `date`. All-zero → the row is deleted (no empty rows). Values are
     * rounded to signed integers (negative = withdrawn, washed at home). Returns the stored counts.
     */
    set(date, counts) {
      assertIsoDate(date);
      const normalized = normalize(counts);
      const allZero = TYPES.every((t) => normalized[t] === 0);
      if (allZero) {
        deleteStmt.run(date);
        return zeros();
      }
      upsertStmt.run({ tripDate: date, ...normalized });
      return normalized;
    },

    /** Map of `{ 'YYYY-MM-DD': { …counts } }` for every non-empty trip, sorted ASC. */
    listAll() {
      const out = {};
      for (const row of listStmt.all()) out[row.tripDate] = rowToCounts(row);
      return out;
    },

    /** Sum of every trip's counts whose date is in `(startExclusiveIso, endInclusiveIso]`. */
    sumForWindow(startExclusiveIso, endInclusiveIso) {
      return rowToCounts(sumStmt.get(String(startExclusiveIso), String(endInclusiveIso)));
    },
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;
defaultModel.TYPES = TYPES;

module.exports = defaultModel;
