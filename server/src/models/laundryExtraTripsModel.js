/**
 * Laundry extra trips model — sole DB access for `laundry_extra_trips`.
 *
 * An extra trip is a laundry trip on a FREE date (not the weekly laundry day): the operator drops the
 * whole dirty pile and takes back what is at the laundry — everything (`pickUpAll = 1`, default) or
 * the seven per-type quantities he actually took (`pickUpAll = 0`). Global scope, one trip per date
 * (same scope as skips and manual lines). The planning summary ledger (`utils/laundryTripLedger.js`)
 * and the inventory engine (`utils/linenInventory.js`) read it; they cap the declared quantities at
 * what is really at the laundry.
 *
 * Exports a default model bound to the production database, and a `create(db)` factory so tests can
 * instantiate against an in-memory schema (same pattern as `laundryTripSkipsModel`).
 *
 * Spec: specs/laundry-extra-trip.md §3.1 + §5.
 */

const db = require('../database');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['singleBeds', 'doubleBeds', 'babyBeds', 'largeTowels', 'mediumTowels', 'smallTowels', 'bathMats'];

function assertIsoDate(date) {
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) {
    throw new Error(`laundryExtraTripsModel: expected ISO date YYYY-MM-DD, got: ${JSON.stringify(date)}`);
  }
}

function zeros() {
  const out = {};
  for (const t of TYPES) out[t] = 0;
  return out;
}

// Declared pick-up quantities are non-negative integers (spec §3.1 rule 4). The cap at what is at the
// laundry belongs to the ledger / engine, which are the only places that know the pool.
function clampCount(v) {
  return Math.max(0, Math.round(Number(v) || 0));
}

function normalizePickUp(counts) {
  const out = zeros();
  for (const t of TYPES) out[t] = clampCount(counts && counts[t]);
  return out;
}

function rowToTrip(row) {
  if (!row) return null;
  const pickUp = zeros();
  for (const t of TYPES) pickUp[t] = Number(row[t]) || 0;
  return { date: row.tripDate, pickUpAll: Number(row.pickUpAll) === 1, pickUp };
}

function createModel(database) {
  const cols = TYPES.join(', ');
  const getStmt = database.prepare(`SELECT tripDate, pickUpAll, ${cols} FROM laundry_extra_trips WHERE tripDate = ?`);
  const listStmt = database.prepare(`SELECT tripDate, pickUpAll, ${cols} FROM laundry_extra_trips ORDER BY tripDate ASC`);
  const upsertStmt = database.prepare(`
    INSERT INTO laundry_extra_trips (tripDate, pickUpAll, ${cols}, updatedAt)
    VALUES (@tripDate, @pickUpAll, ${TYPES.map((t) => `@${t}`).join(', ')}, datetime('now'))
    ON CONFLICT(tripDate) DO UPDATE SET
      pickUpAll = @pickUpAll,
      ${TYPES.map((t) => `${t} = @${t}`).join(', ')},
      updatedAt = datetime('now')
  `);
  const removeStmt = database.prepare('DELETE FROM laundry_extra_trips WHERE tripDate = ?');
  const countStmt = database.prepare('SELECT COUNT(*) AS c FROM laundry_extra_trips');

  return {
    /** Every extra trip, sorted ASC: `[{ date, pickUpAll, pickUp: {7 types} }]`. */
    listAll() {
      return listStmt.all().map(rowToTrip);
    },

    /** One trip (or null). */
    get(date) {
      assertIsoDate(date);
      return rowToTrip(getStmt.get(date));
    },

    /**
     * Upsert the trip for `date`. `pickUpAll` true → the seven counts are stored as 0 (ignored).
     * Otherwise the counts are rounded + clamped ≥ 0. Returns the stored trip.
     */
    set(date, { pickUpAll = true, pickUp } = {}) {
      assertIsoDate(date);
      const all = Boolean(pickUpAll);
      const counts = all ? zeros() : normalizePickUp(pickUp);
      upsertStmt.run({ tripDate: date, pickUpAll: all ? 1 : 0, ...counts });
      return { date, pickUpAll: all, pickUp: counts };
    },

    /** Idempotent delete. Returns true if a row was removed. */
    remove(date) {
      assertIsoDate(date);
      return removeStmt.run(date).changes > 0;
    },

    /** Test-friendly accessor. */
    count() {
      return countStmt.get().c;
    },
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;
defaultModel.TYPES = TYPES;

module.exports = defaultModel;
