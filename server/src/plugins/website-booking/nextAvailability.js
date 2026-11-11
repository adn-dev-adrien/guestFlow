/**
 * The first day a stay can actually START, from a given day (specs/public-api.md
 * `GET /properties/:id/availability`, `nextAvailableDate`; specs/wp-booking-widget-redesign.md
 * rule 30).
 *
 * The site opens its calendar on two months. When both are closed — a lodging that opens in April,
 * visited in October — the visitor reads « fully booked » and leaves, unless something says when
 * the first bookable arrival is. The server answers it: it is the only party that sees beyond the
 * window the site asked for, and the only one that knows the stay rules.
 *
 * « Bookable » is more than « a free night »: an isolated free night under a 2-night minimum, or a
 * Tuesday when arrivals are on Saturdays, would send the visitor to a date the quote then refuses.
 * A day qualifies when some stay starting on it — free nights only, up to `maxStayNights` — passes
 * `isStayAllowed(start, end)`: the season's minimum and maximum stay and its changeover days,
 * resolved by the pricing engine and `utils/changeover.js` (see `stayRulesPredicate`).
 *
 * Pure: the blocked nights of the requested window come in, and `loadBlocked(from, to)` is called
 * once, only when the search leaves that window. Past days never count.
 */

const sdk = require('../sdk');

const DEFAULT_HORIZON_DAYS = 365;
const DEFAULT_MAX_STAY_NIGHTS = 62;

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} p
 * @param {string} p.from - first day of the requested window (ISO)
 * @param {string} p.to - end of the requested window, exclusive (ISO)
 * @param {string} p.todayIso - today in the lodgings' timezone (ISO)
 * @param {string[]} p.blockedDates - blocked nights of [from, to)
 * @param {(from: string, to: string) => string[]} p.loadBlocked - blocked nights of another window
 * @param {(start: string, end: string) => boolean|{ ok: boolean, stop?: boolean }} [p.isStayAllowed]
 *   the stay rules; `stop: true` says no longer stay from this arrival can pass. Default: any stay.
 * @param {number} [p.horizonDays=365] - how far past the start an arrival may be
 * @param {number} [p.maxStayNights=62] - the longest stay tried from one arrival
 * @returns {string|null} the first bookable arrival on or after max(from, today), or null
 */
function findNextAvailableDate({
  from, to, todayIso, blockedDates, loadBlocked, isStayAllowed = () => true,
  horizonDays = DEFAULT_HORIZON_DAYS, maxStayNights = DEFAULT_MAX_STAY_NIGHTS,
}) {
  const start = from > todayIso ? from : todayIso;
  const horizon = addDays(start, horizonDays);
  const blocked = new Set(blockedDates || []);
  let beyondLoaded = false;
  const isBlocked = (day) => {
    if (day >= to && !beyondLoaded) {
      beyondLoaded = true;
      (loadBlocked(to, addDays(horizon, maxStayNights)) || []).forEach((d) => blocked.add(d));
    }
    return blocked.has(day);
  };

  for (let arrival = start; arrival < horizon; arrival = addDays(arrival, 1)) {
    if (isBlocked(arrival)) continue;
    for (let nights = 1; nights <= maxStayNights; nights += 1) {
      if (nights > 1 && isBlocked(addDays(arrival, nights - 1))) break;
      const verdict = isStayAllowed(arrival, addDays(arrival, nights));
      if (verdict === true || (verdict && verdict.ok)) return arrival;
      if (verdict && verdict.stop) break;
    }
  }
  return null;
}

/**
 * The stay rules of one property as a predicate for `findNextAvailableDate`: the engine's own
 * per-night minimum/maximum stay (`calculateBaseStayPrice`) and changeover days (`checkChangeover`),
 * never a second reading of the seasons.
 *
 * @param {object[]} rules - the property's `pricing_rules` rows, ordered as the engine reads them
 */
function stayRulesPredicate(rules) {
  const { calculateBaseStayPrice } = sdk.coreModule('pricing');
  const { checkChangeover } = sdk.coreModule('changeover');
  return (start, end) => {
    const changeover = checkChangeover(rules, start, end);
    // The arrival weekday is the first night's rule: no length of stay changes it.
    if (changeover.arrivalBreached) return { ok: false, stop: true };
    const base = calculateBaseStayPrice(rules, start, end);
    // Past the maximum stay, a longer one cannot pass either.
    if (base.maxNightsBreached) return { ok: false, stop: true };
    return { ok: !base.minNightsBreached && !changeover.departureBreached };
  };
}

module.exports = { findNextAvailableDate, stayRulesPredicate, DEFAULT_HORIZON_DAYS };
