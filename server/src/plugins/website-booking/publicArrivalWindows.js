/**
 * Public calendar windows (specs/booking-drawer-friction.md rules 10-13) — pure.
 *
 * For every arrival date the public calendar may offer, the minimum stay and the EARLIEST valid
 * departure, computed with the rule the quote enforces (specs/pricing-min-nights-per-range.md rule 3):
 * a stay of n nights is long enough when n ≥ the maximum effective minimum over the n nights it
 * touches. The widget only paints the result; it never derives a minimum itself.
 */

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object}   p
 * @param {string}   p.from         first date of the window (inclusive)
 * @param {string}   p.to           last date of the window (exclusive)
 * @param {string}   p.todayIso     arrivals before today are never offered
 * @param {Set}      p.blockedSet   blocked nights; must extend `maxNights` past `to`
 * @param {Function} p.minNightsFor (dateIso) => effective minimum of that night, or null when unpriced
 * @param {number}   [p.maxNights]  how far a window is searched before the arrival is given up
 * @returns {{date: string, minNights: number, earliestDeparture: string}[]}
 */
function computeArrivalWindows({ from, to, todayIso, blockedSet, minNightsFor, maxNights = 30 }) {
  const out = [];
  for (let date = from < todayIso ? todayIso : from; date < to; date = addDays(date, 1)) {
    let required = 0;
    let night = date;
    for (let n = 1; n <= maxNights; n += 1) {
      const min = blockedSet.has(night) ? null : minNightsFor(night);
      if (min == null) break;
      required = Math.max(required, min);
      if (n >= required) {
        out.push({ date, minNights: required, earliestDeparture: addDays(date, n) });
        break;
      }
      night = addDays(night, 1);
    }
  }
  return out;
}

module.exports = { computeArrivalWindows, addDays };
