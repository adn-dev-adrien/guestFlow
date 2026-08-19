/**
 * Laundry trip ledger — the pure « trip sequence + pool » logic behind the Planning laundry summary
 * (specs/laundry-extra-trip.md §3.2, on top of specs/weekly-bed-linen-tracking.md §3.3 and
 * specs/skip-laundry-trip.md §3.2).
 *
 * The trip sequence S = every non-skipped regular laundry day ∪ every ACTIVE extra trip (an extra
 * trip stored on the laundry weekday is inert). For a trip T:
 *   - prevTrip(T)  = the latest element of S strictly before T; the regular anchor R(T) is the last
 *                    non-skipped regular day before T (null past the lookback → T − 7, the historical
 *                    degenerate rule), and any active extra trip in (R, T) comes later than R.
 *   - Drop-off(T)  = buildBlock(prevTrip(T), T] — reservation linen + signed manual lines, floored.
 *   - Pool before T: a regular trip takes the whole pool back, so right after R the pool is exactly
 *                    Drop-off(R); then each extra E in (R, T) is replayed: pick(E) = pickUpAll ? pool
 *                    : min(pool, declared) per type, pool ← pool − pick(E) + Drop-off(E).
 *   - Pick-up(T)   = the whole pool for a regular trip, pick(T) for an extra trip (which also reports
 *                    leftAtLaundry = pool − pick).
 * Without extra trips this reproduces the pre-feature contract exactly: Pick-up(L) = Drop-off(prev).
 *
 * `buildBlock(startExclusive, endInclusive)` and `incompleteFor(startExclusive, endInclusive)` are
 * injected (the SQL window sums live in the models), so the ledger is unit-testable with fakes and
 * shared by the summary endpoint and the extra-trip preview. No memoization on purpose: the call
 * sequence per emitted trip is (drop-off window, then the pool's windows), the order the existing
 * controller tests pin.
 */

const {
  addDays,
  weekdayOf,
  previousNonSkippedRegularBefore,
  activeExtraDates,
} = require('./laundryWindow');

const BLOCK_KEYS = Object.freeze([
  'singleBeds', 'doubleBeds', 'babyBeds',
  'largeTowels', 'mediumTowels', 'smallTowels',
  'bathMats',
]);

function emptyBlock() {
  const out = {};
  for (const k of BLOCK_KEYS) out[k] = 0;
  return out;
}

function keysOf(...blocks) {
  const keys = new Set(BLOCK_KEYS);
  for (const b of blocks) for (const k of Object.keys(b || {})) keys.add(k);
  return keys;
}

function addBlocks(a, b) {
  const out = {};
  for (const k of keysOf(a, b)) out[k] = (Number(a && a[k]) || 0) + (Number(b && b[k]) || 0);
  return out;
}

function subBlocks(a, b) {
  const out = {};
  for (const k of keysOf(a, b)) out[k] = Math.max(0, (Number(a && a[k]) || 0) - (Number(b && b[k]) || 0));
  return out;
}

function minBlocks(a, b) {
  const out = {};
  for (const k of keysOf(a, b)) out[k] = Math.max(0, Math.min(Number(a && a[k]) || 0, Number(b && b[k]) || 0));
  return out;
}

/**
 * Assemble the two SQL-backed builders the ledger needs from the models. Moved here from
 * `planningController.laundrySummary` so the summary and the extra-trip preview share one
 * definition of « what a window holds ».
 */
function makeBlockBuilders({ laundryModel, laundryManualAdditionsModel }) {
  const buildBlock = (startExclusive, endInclusive) => {
    const block = {
      ...laundryModel.dropOffForWindow(startExclusive, endInclusive),
      ...laundryModel.dropOffBathroomForWindow(startExclusive, endInclusive),
      ...laundryModel.dropOffBathMatForWindow(startExclusive, endInclusive),
    };
    const manual = laundryManualAdditionsModel.sumForWindow(startExclusive, endInclusive);
    // specs/laundry-manual-removals.md §3 rule 3 — the manual line is SIGNED: a negative value is
    // linen the operator washed himself, so it leaves the trip. Floored at 0 per type: one cannot
    // deposit (nor fetch) a negative pile of sheets.
    for (const k of Object.keys(manual)) {
      block[k] = Math.max(0, (Number(block[k]) || 0) + Number(manual[k] || 0));
    }
    return block;
  };
  // specs/laundry-counts-explicit-option-only.md §3.2 rule 8 — only the drop-off side carries the
  // "declared linen, no quantity yet" list. Guarded so an older injected model (tests) without the
  // method degrades to an empty list.
  const incompleteFor = (startExclusive, endInclusive) => (
    typeof laundryModel.incompleteBedConfigForWindow === 'function'
      ? laundryModel.incompleteBedConfigForWindow(startExclusive, endInclusive)
      : []
  );
  return { buildBlock, incompleteFor };
}

/**
 * Build a ledger bound to one configuration.
 *
 * @param {object} p
 * @param {number} p.weekday — laundry weekday (0..6)
 * @param {Set<string>|string[]} p.skippedDates
 * @param {Map<string,object>|Array<object>} p.extraTrips — `{ date, pickUpAll, pickUp: {7 types} }`
 *   per extra trip (a Map keyed by date, or the model's `listAll()` array)
 * @param {Function} p.buildBlock — `(startExclusive, endInclusive) → block`
 * @param {Function} p.incompleteFor — `(startExclusive, endInclusive) → [...]`
 * @param {number} [p.lookbackDays=28]
 */
function createTripLedger({ weekday, skippedDates, extraTrips, buildBlock, incompleteFor, lookbackDays = 28 }) {
  const skipped = skippedDates instanceof Set ? skippedDates : new Set(skippedDates || []);
  const extrasByDate = new Map();
  const extraEntries = extraTrips instanceof Map ? Array.from(extraTrips.entries()) : (extraTrips || []).map((t) => [t.date, t]);
  for (const [date, trip] of extraEntries) {
    if (!trip) continue;
    extrasByDate.set(date, { pickUpAll: trip.pickUpAll !== false, pickUp: trip.pickUp || {} });
  }
  const extraDates = activeExtraDates(extrasByDate.keys(), weekday);
  const incomplete = typeof incompleteFor === 'function' ? incompleteFor : () => [];

  const isRegular = (date) => weekdayOf(date) === weekday;
  const isActiveExtra = (date) => !isRegular(date) && extrasByDate.has(date);

  // Regular anchor strictly before `date`; the historical `T − 7` fallback keeps producing windows
  // when the whole lookback is skipped (the pre-feature degenerate rule, pinned by tests).
  const anchorBefore = (date) => previousNonSkippedRegularBefore(date, weekday, skipped, lookbackDays) || addDays(date, -7);

  const extrasBetween = (startExclusive, endExclusive) => extraDates.filter((d) => d > startExclusive && d < endExclusive);

  const prevTrip = (date) => {
    const anchor = anchorBefore(date);
    const between = extrasBetween(anchor, date);
    return between.length > 0 ? between[between.length - 1] : anchor;
  };

  const drop = (date) => buildBlock(prevTrip(date), date);

  const pickFor = (date, pool) => {
    const trip = extrasByDate.get(date);
    if (!trip || trip.pickUpAll) return pool;
    return minBlocks(pool, trip.pickUp);
  };

  // The pool at the laundry right before `date`'s own trip. Returned as the anchor's drop block
  // untouched when no extra trip sits in between, so the historical payload shape is preserved.
  const poolBefore = (date) => {
    const anchor = anchorBefore(date);
    let pool = drop(anchor);
    for (const extra of extrasBetween(anchor, date)) {
      const pick = pickFor(extra, pool);
      pool = addBlocks(subBlocks(pool, pick), drop(extra));
    }
    return pool;
  };

  /**
   * The summary entry for one trip date, or null when `date` is neither a regular laundry day nor an
   * active extra trip. Skipped regular days emit zeros and query nothing.
   */
  const entryFor = (date) => {
    if (isRegular(date)) {
      if (skipped.has(date)) {
        return { date, kind: 'regular', dropOff: { ...emptyBlock(), incomplete: [] }, pickUp: { ...emptyBlock() } };
      }
      const dropOff = { ...drop(date), incomplete: incomplete(prevTrip(date), date) };
      const pickUp = poolBefore(date);
      return { date, kind: 'regular', dropOff, pickUp };
    }
    if (!isActiveExtra(date)) return null;
    const dropOff = { ...drop(date), incomplete: incomplete(prevTrip(date), date) };
    const pool = poolBefore(date);
    const pickUp = pickFor(date, pool);
    const trip = extrasByDate.get(date);
    return {
      date,
      kind: 'extra',
      dropOff,
      pickUp,
      pickUpAll: trip.pickUpAll,
      leftAtLaundry: subBlocks(pool, pickUp),
    };
  };

  /**
   * What an extra trip on `date` would drop and what would be at the laundry before it. Any record
   * stored on `date` itself is ignored (only trips strictly before `date` shape the pool), so the
   * preview serves both the create and the edit flows.
   */
  const previewFor = (date) => ({
    dropOff: drop(date),
    atLaundry: poolBefore(date),
  });

  return { entryFor, previewFor, prevTrip, poolBefore, isRegular, isActiveExtra, extraDates };
}

module.exports = {
  createTripLedger,
  makeBlockBuilders,
  emptyBlock,
  BLOCK_KEYS,
  __test: { addBlocks, subBlocks, minBlocks },
};
