/**
 * Laundry trip ledger — the pure « trip sequence + batches at the laundry » logic behind the Planning
 * laundry cards (specs/linen-laundry-days.md §3.2, on top of specs/laundry-extra-trip.md §3.2,
 * specs/weekly-bed-linen-tracking.md §3.3 and specs/skip-laundry-trip.md §3.2).
 *
 * The trip sequence S = every non-skipped regular laundry day (the weekdays of the schedule version in
 * force on that date) ∪ every ACTIVE extra trip (an extra trip stored on a regular day is inert). For a
 * trip T:
 *   - prevTrip(T)  = the latest element of S strictly before T within the 28-day lookback (T − 7 when
 *                    none — the historical degenerate rule).
 *   - Drop-off(T)  = buildBlock(prevTrip(T), T] — reservation linen + signed manual lines, floored.
 *   - The laundry holds batches: each trip drops one (Drop-off, ready `turnaroundDays` later) and
 *     collects the batches that are ready — all of them for a regular trip, `min(ready, declared)`
 *     per type oldest first for a partial extra trip. The state before T is replayed from the last
 *     non-skipped regular trip before it (that trip collected everything ready).
 *   - Pick-up(T)   = what that trip collects, with the drop dates it comes from (`fromTrips`);
 *                    `stillAtLaundry` is what stays after it (T's own drop excluded).
 * With one weekday and a one-day turnaround every batch is ready at the next trip, so this reproduces
 * the pre-feature contract exactly: Pick-up(L) = Drop-off(prev).
 *
 * `buildBlock(startExclusive, endInclusive)` and `incompleteFor(startExclusive, endInclusive)` are
 * injected (the SQL window sums live in the models), so the ledger is unit-testable with fakes and
 * shared by the Planning endpoint and the extra-trip preview. No memoization on purpose: the call
 * sequence per emitted trip is (drop-off window, then the windows of the batches still at the laundry),
 * the order the existing controller tests pin.
 */

const { addDays, previousMatchingDay } = require('./laundryWindow');
const { addBatch, collectBatches, totalOf } = require('./laundryBatches');
const { MAX_TURNAROUND_DAYS } = require('./laundrySchedule');

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

const REPLAY_DAYS = 42;

/**
 * Build a ledger bound to one configuration.
 *
 * @param {object} p
 * @param {object} p.schedule — `createSchedule(...)` from `laundrySchedule.js`
 * @param {Set<string>|string[]} p.skippedDates
 * @param {Map<string,object>|Array<object>} p.extraTrips — `{ date, pickUpAll, pickUp: {7 types} }`
 *   per extra trip (a Map keyed by date, or the model's `listAll()` array)
 * @param {Function} p.buildBlock — `(startExclusive, endInclusive) → block`
 * @param {Function} p.incompleteFor — `(startExclusive, endInclusive) → [...]`
 * @param {number} [p.lookbackDays=28]
 */
function createTripLedger({ schedule, skippedDates, extraTrips, buildBlock, incompleteFor, lookbackDays = 28 }) {
  const skipped = skippedDates instanceof Set ? skippedDates : new Set(skippedDates || []);
  const extrasByDate = new Map();
  const extraEntries = extraTrips instanceof Map ? Array.from(extraTrips.entries()) : (extraTrips || []).map((t) => [t.date, t]);
  for (const [date, trip] of extraEntries) {
    if (!trip) continue;
    extrasByDate.set(date, { pickUpAll: trip.pickUpAll !== false, pickUp: trip.pickUp || {} });
  }
  const incomplete = typeof incompleteFor === 'function' ? incompleteFor : () => [];

  const isRegular = (date) => schedule.isRegularDay(date);
  const isActiveExtra = (date) => !isRegular(date) && extrasByDate.has(date);
  const isTrip = (date) => (isRegular(date) && !skipped.has(date)) || isActiveExtra(date);
  const extraDates = Array.from(extrasByDate.keys()).filter(isActiveExtra).sort();

  const prevTrip = (date) => previousMatchingDay(date, isTrip, lookbackDays) || addDays(date, -7);

  const drop = (date) => buildBlock(prevTrip(date), date);
  const blockCounts = (block) => Object.fromEntries(BLOCK_KEYS.map((k) => [k, Number(block[k]) || 0]));

  const collectOn = (batches, date) => {
    const trip = extrasByDate.get(date);
    const wanted = trip && isActiveExtra(date) && !trip.pickUpAll ? trip.pickUp : null;
    return collectBatches(batches, date, BLOCK_KEYS, wanted);
  };

  // The batches at the laundry right before `date`'s own trip. A regular, non-skipped trip F collects
  // every batch that is ready, so the state before `date` follows from F alone: the batches dropped
  // before F that were still not ready at F (at most 14 days back), then every trip from F on. That
  // keeps the drop-off windows queried to the few that matter. With no such trip in the lookback the
  // laundry is replayed from the 42 days before `date` (the engine's own warm-up). An extra record
  // stored on `date` itself is never part of it.
  const batchesBefore = (date) => {
    const anchor = previousMatchingDay(date, (d) => isRegular(d) && !skipped.has(d), lookbackDays);
    const batchOf = (d) => ({ dropDate: d, readyFrom: schedule.readyFrom(d), counts: blockCounts(drop(d)) });
    let batches = [];
    let from;
    if (anchor) {
      for (let d = addDays(anchor, -MAX_TURNAROUND_DAYS); d < anchor; d = addDays(d, 1)) {
        if (isTrip(d) && schedule.readyFrom(d) > anchor) batches = addBatch(batches, batchOf(d));
      }
      from = anchor;
    } else {
      from = addDays(date, -REPLAY_DAYS);
    }
    for (let d = from; d < date; d = addDays(d, 1)) {
      if (isTrip(d)) batches = addBatch(collectOn(batches, d).remaining, batchOf(d));
    }
    return batches;
  };

  const stillAt = (remaining) => {
    if (remaining.length === 0) return null;
    const { counts, readyOn } = totalOf(remaining, BLOCK_KEYS);
    return { counts, readyOn };
  };

  /**
   * The summary entry for one trip date, or null when `date` is neither a regular laundry day nor an
   * active extra trip. Skipped regular days emit zeros and query nothing.
   */
  const entryFor = (date) => {
    if (isRegular(date) && skipped.has(date)) {
      return {
        date,
        kind: 'regular',
        dropOff: { ...emptyBlock(), incomplete: [] },
        pickUp: { ...emptyBlock(), fromTrips: [] },
        stillAtLaundry: null,
      };
    }
    if (!isRegular(date) && !isActiveExtra(date)) return null;
    const dropOff = { ...drop(date), incomplete: incomplete(prevTrip(date), date) };
    const { collected, fromTrips, remaining } = collectOn(batchesBefore(date), date);
    const entry = {
      date,
      kind: isRegular(date) ? 'regular' : 'extra',
      dropOff,
      pickUp: { ...collected, fromTrips },
      stillAtLaundry: stillAt(remaining),
    };
    if (entry.kind === 'extra') {
      entry.pickUpAll = extrasByDate.get(date).pickUpAll;
      entry.leftAtLaundry = totalOf(remaining, BLOCK_KEYS).counts;
    }
    return entry;
  };

  /**
   * What an extra trip on `date` would drop and what it could collect there (the batches ready by
   * then). Any record stored on `date` itself is ignored (only trips strictly before `date` shape the
   * laundry), so the preview serves both the create and the edit flows.
   */
  const previewFor = (date) => ({
    dropOff: drop(date),
    atLaundry: collectBatches(batchesBefore(date), date, BLOCK_KEYS, null).collected,
  });

  return { entryFor, previewFor, prevTrip, isRegular, isActiveExtra, extraDates };
}

module.exports = {
  createTripLedger,
  makeBlockBuilders,
  emptyBlock,
  BLOCK_KEYS,
};
