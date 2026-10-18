/**
 * Laundry trip manual additions model — sole DB access for `laundry_trip_manual_additions`.
 *
 * A manual line is per laundry trip date (`YYYY-MM-DD`), global (one human, one trip per day —
 * same scope as `skipsModel`). It holds seven SIGNED per-type counts (bath mats included):
 *   - positive = linen the operator washes on that trip on top of what the reservations imply. The
 *     planning summary folds it into « À apporter / À récupérer » and the inventory engine washes it
 *     like reservation linen (clean → laundry → clean).
 *   - negative = linen the operator washes HIMSELF, withdrawn from the trip: it leaves « À apporter »,
 *     never returns in « À récupérer », and the engine puts it straight back in the clean stock
 *     (specs/laundry-manual-removals.md).
 *
 * Spec: specs/manual-laundry-additions.md §4.1 + §5, specs/laundry-manual-removals.md §4.1.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// `bathMats` joined on 2026-10-18 (specs/laundry-bath-mat.md rule 13): the card counts the mats, so the
// manual line can add or withdraw them too.
const TYPES = ['singleBeds', 'doubleBeds', 'babyBeds', 'largeTowels', 'mediumTowels', 'smallTowels', 'bathMats'];

function assertIsoDate(date) {
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) {
    throw new Error(`laundryManualAdditionsModel: expected ISO date YYYY-MM-DD, got: ${JSON.stringify(date)}`);
  }
}

function zeros() {
  return Object.fromEntries(TYPES.map((t) => [t, 0]));
}

// A SIGNED integer (specs/laundry-manual-removals.md §3 rules 1-2): positive = extra linen to wash on
// this trip, negative = linen the operator washes himself, withdrawn from the trip. Rounding is the
// only authoritative normalisation left — the clamping that matters (never deposit a negative pile,
// never wash more than what is dirty) belongs to the summary and to the inventory engine, which are
// the two places that know what the trip actually holds.
function clampCount(v) {
  // Finite guard (2026-10-08 audit DATA-5): this is reception-writable, and JSON.parse('1e999') is
  // Infinity, which `Number(v) || 0` lets through and `Math.round` keeps as Infinity — corrupting
  // every downstream linen sum. A non-finite count is meaningless here, so it collapses to 0.
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
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
    INSERT INTO laundry_trip_manual_additions (tripDate, ${TYPES.join(', ')}, updatedAt)
    VALUES (@tripDate, ${TYPES.map((t) => `@${t}`).join(', ')}, datetime('now'))
    ON CONFLICT(tripDate) DO UPDATE SET
      ${TYPES.map((t) => `${t} = @${t}`).join(', ')},
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
    /** The per-type counts for `date` (zeros when no row). */
    get(date) {
      assertIsoDate(date);
      return rowToCounts(getStmt.get(date));
    },

    /**
     * Upsert the counts for `date`. All-zero → the row is deleted (no empty rows). Values are
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

    /**
     * Idempotent delete of the manual line of `date`. Used when an extra laundry trip is removed
     * (specs/laundry-extra-trip.md §3.1 rule 6) so no manual line survives on a date that is no
     * longer a trip. Returns true if a row was removed.
     */
    remove(date) {
      assertIsoDate(date);
      return deleteStmt.run(date).changes > 0;
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

module.exports = { create: createModel, TYPES };
