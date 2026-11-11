/**
 * The state of one property as Google should see it (specs/google-vacation-rentals-feed.md rules 4-9).
 * Orchestration only: every price comes out of the website's quote (`quote`, the core's directQuote),
 * every refusal out of the engine's own flags; nothing is re-derived here.
 *
 *   rates  Map itineraryKey → { checkin, nights, guests, amountCents, beforeTaxCents }
 *   days   Map date → { date, inventory, minLos, maxLos, closedToArrival, closedToDeparture, closed }
 *
 * deps: { calculateBaseStayPrice(rules, start, end), checkChangeover(rules, start, end), quote(input),
 *         pause?() → Promise } — `pause` yields to the event loop after each priced stay length, so a
 *         full horizon (tens of thousands of quotes) never holds the server more than a few ms.
 */

const { addDays, lengthsFor, partySizes, itineraryKey } = require('./itineraries');

const cents = (euros) => Math.round(Number(euros || 0) * 100);
const nextTurn = () => new Promise((resolve) => { setImmediate(resolve); });

/**
 * input: { property, rules, cap, today, horizonDays, maxLos, blocked: Set, closures: Set,
 *          reuse?: Map itineraryKey → amountCents }
 *
 * `reuse` — the amounts already sent, for a run caused by a reservation or an iCal import: a booking
 * moves no price (rule 11), so a stay whose every party size was already sent keeps its amounts and
 * only the stays that became sellable are quoted. Never given to a pricing or a full run.
 *
 * A night is « priced » when a pricing rule covers it: the engine's 100 € fallback for an uncovered
 * night is never sent (edge case « no pricing rule on a date »).
 */
async function computePropertyState(input, deps) {
  const {
    property, rules, cap, today, horizonDays, maxLos, blocked, closures, reuse = null,
  } = input;
  const {
    calculateBaseStayPrice, checkChangeover, quote, pause = nextTurn,
  } = deps;
  const horizonEnd = addDays(today, horizonDays);
  const sizes = partySizes(property, cap);

  const nightInfo = new Map();
  const infoOf = (date) => {
    if (!nightInfo.has(date)) {
      const one = calculateBaseStayPrice(rules, date, addDays(date, 1));
      nightInfo.set(date, {
        priced: (one.minNightsRules || []).length > 0,
        minLos: Number(one.requiredMinNights || 1),
        maxLos: one.requiredMaxNights == null ? null : Number(one.requiredMaxNights),
      });
    }
    return nightInfo.get(date);
  };
  const sellableNight = (date) => !blocked.has(date) && infoOf(date).priced;

  const rates = new Map();
  const minLosByArrival = new Map();
  let quotes = 0;

  for (let checkin = today; checkin < horizonEnd; checkin = addDays(checkin, 1)) {
    let minLos = null;
    for (const nights of lengthsFor(checkin, { maxLos, horizonEnd })) {
      // A stay crossing a blocked or unpriced night is refused, and so is every longer one.
      if (!sellableNight(addDays(checkin, nights - 1))) break;
      const checkout = addDays(checkin, nights);
      const base = calculateBaseStayPrice(rules, checkin, checkout);
      if (minLos === null && !base.minNightsBreached) minLos = nights;
      if (base.minNightsBreached || base.maxNightsBreached) continue;
      if (checkChangeover(rules, checkin, checkout).breached) continue;
      const keys = sizes.map((guests) => itineraryKey({ checkin, nights, guests }));
      if (reuse && keys.every((key) => reuse.has(key))) {
        sizes.forEach((guests, i) => rates.set(keys[i], {
          checkin, nights, guests, amountCents: reuse.get(keys[i]), beforeTaxCents: null,
        }));
        continue;
      }
      sizes.forEach((guests, i) => {
        const q = quote({ propertyId: property.id, startDate: checkin, endDate: checkout, adults: guests });
        quotes += 1;
        // Rule 5 — what the website would refuse is not priced.
        if (!q || q.error || q.minNightsBreached || q.maxNightsBreached || q.changeoverBreached) return;
        const amountCents = cents(q.totalStayPrice);
        rates.set(keys[i], {
          checkin, nights, guests, amountCents, beforeTaxCents: amountCents - cents(q.touristTaxTotal),
        });
      });
      await pause();
    }
    minLosByArrival.set(checkin, minLos);
  }

  const days = new Map();
  // Past the horizon, `maxLos` more days are sent closed (rule 8): a stay never reaches an unsent date.
  const daysEnd = addDays(horizonEnd, maxLos);
  for (let date = today; date < daysEnd; date = addDays(date, 1)) {
    if (date >= horizonEnd) {
      days.set(date, {
        date, inventory: 0, minLos: null, maxLos: null, closedToArrival: 0, closedToDeparture: 0, closed: 1,
      });
      continue;
    }
    const info = infoOf(date);
    days.set(date, {
      date,
      // Rule 6 — 1 on a free night, 0 on a night a reservation, an iCal import or a closure blocks.
      inventory: blocked.has(date) ? 0 : 1,
      // Rule 7 — the shortest stay the engine accepts from this arrival; the night's own minimum
      // when no stay from it is sellable.
      minLos: minLosByArrival.get(date) ?? (info.priced ? info.minLos : null),
      maxLos: info.maxLos,
      closedToArrival: info.priced && checkChangeover(rules, date, addDays(date, 1)).arrivalBreached ? 1 : 0,
      // The departure weekday is the one of the checkout date, resolved on the night before it.
      closedToDeparture: checkChangeover(rules, addDays(date, -1), date).departureBreached ? 1 : 0,
      closed: closures.has(date) || !info.priced ? 1 : 0,
    });
  }

  return { rates, days, sizes, quotes };
}

module.exports = { computePropertyState, cents };
