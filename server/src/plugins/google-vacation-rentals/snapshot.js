/**
 * The difference between what a property should show on Google and what Google last acknowledged
 * (specs/google-vacation-rentals-feed.md rule 10). Pure.
 *
 * An itinerary that is no longer sold (blocked, refused) is not re-sent: its nights already go out at
 * inventory 0 or closed. It only leaves the snapshot, so that it is priced again once sellable.
 */

const { DAY_FIELDS } = require('./model');

const sameDay = (a, b) => DAY_FIELDS.every((k) => (a[k] == null ? null : Number(a[k])) === (b[k] == null ? null : Number(b[k])));

/**
 * state: { rates: Map key → rate, days: Map date → day }; snapshot: { rates: Map key → cents, days: Map date → row }.
 * full: re-send everything computed (rule 13), whatever the snapshot says.
 */
function diffState(state, snapshot, { full = false } = {}) {
  const rates = [];
  state.rates.forEach((rate, key) => {
    if (full || snapshot.rates.get(key) !== rate.amountCents) rates.push(rate);
  });
  const removedRates = [];
  snapshot.rates.forEach((_, key) => {
    if (state.rates.has(key)) return;
    const [checkin, nights, guests] = key.split('|');
    removedRates.push({ checkin, nights: Number(nights), guests: Number(guests) });
  });
  const days = [];
  state.days.forEach((day, date) => {
    const before = snapshot.days.get(date);
    if (full || !before || !sameDay(before, day)) days.push(day);
  });
  return { rates, removedRates, days };
}

const isEmptyDiff = (diff) => !diff.rates.length && !diff.removedRates.length && !diff.days.length;

module.exports = { diffState, isEmptyDiff };
