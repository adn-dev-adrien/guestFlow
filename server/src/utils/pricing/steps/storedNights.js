/**
 * STEP storedNights — the nights of a stored stay, for a sale (specs/pricing/pricing-components.md §3 rules 8 and 9).
 *
 * A sale on a stay (selling, offering, removing, discounting a line) prices the nights as they were sold: the stored nights
 * (`reservation_nights`, the price lock) ARE the nightly breakdown, and NIGHTS is not called — no tariff is read, no minimum or maximum
 * nights, no changeover is judged (rule 9). It provides the keys of the `nights` step, so the steps after it read the same context.
 * A stay whose stored nights do not cover each of its nights with a price, a mode and a season (prod copy 2026-11-11: one past stay of
 * 62) has no stored price to read: it is priced by NIGHTS as before, its judgments neutral all the same (a sale never re-judges a stay).
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { mergeNightlyBreakdownWithLocked, addDaysToIsoDate } = require('../nights');
const nights = require('./nights');

const NO_CHANGEOVER_BREACH = Object.freeze({
  breached: false, arrivalBreached: false, departureBreached: false, requiredArrivalWeekday: null, requiredDepartureWeekday: null,
  requiredArrivalDayLabel: null, requiredDepartureDayLabel: null,
});

function stayDates(startDate, endDate) {
  const dates = [];
  for (let day = String(startDate); day < String(endDate) && dates.length < 3660; day = addDaysToIsoDate(day, 1)) dates.push(day);
  return dates;
}

// The stored nights, when they price every night of the stay as sold; else null.
function storedBreakdown(lockedNightlyBreakdown, startDate, endDate) {
  const dates = stayDates(startDate, endDate);
  const locked = (Array.isArray(lockedNightlyBreakdown) ? lockedNightlyBreakdown : []).filter((line) => line?.date);
  if (!dates.length || locked.length !== dates.length) return null;
  const byDate = new Map(locked.map((line) => [String(line.date), line]));
  const covered = dates.every((date) => {
    const line = byDate.get(date);
    return line && line.price != null && Number.isFinite(Number(line.price)) && line.pricingMode && line.seasonLabel;
  });
  return covered ? mergeNightlyBreakdownWithLocked(locked, dates.map((date) => ({ date }))) : null;
}

const neutralJudgments = {
  changeover: NO_CHANGEOVER_BREACH, maxNightsBreached: false, minNightsBreached: false,
};

const step = {
  id: 'storedNights',
  requires: nights.requires,
  provides: nights.provides,
  apply(ctx) {
    const { endDate, lockedNightlyBreakdown, startDate } = ctx;
    const mergedNightly = storedBreakdown(lockedNightlyBreakdown, startDate, endDate);
    if (!mergedNightly) {
      const priced = nights.apply(ctx);
      return priced.halt !== undefined ? priced : { ...priced, ...neutralJudgments };
    }
    const baseAccommodationPrice = mergedNightly.totalPrice;
    return {
      ...ctx,
      ...neutralJudgments,
      baseAccommodationPrice,
      freshUnpricedNights: [],
      maxNightsRules: [],
      mergedNightly,
      minNightsRules: [],
      nightlyBreakdown: mergedNightly.nightlyBreakdown,
      nights: mergedNightly.nightlyBreakdown.length,
      requiredMaxNights: null,
      requiredMinNights: null,
      totalPrice: roundMoney(baseAccommodationPrice),
    };
  },
};

module.exports = step;
module.exports.storedBreakdown = storedBreakdown;
