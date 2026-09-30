/**
 * Calendar days in Paris time, as `YYYY-MM-DD` strings. Every date the console decides on (end of a
 * subscription, a state boundary, an erasure date) is a Paris day, never an instant.
 */

const { licence } = require('./gf');

const parisDay = (date) => licence.parisDay(date);

const toDate = (day) => new Date(`${day}T00:00:00Z`);
const toDay = (date) => date.toISOString().slice(0, 10);

function addDays(day, n) {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
}

// Month arithmetic clamps to the last day of the target month: 31 January + 1 month = 28 February.
function addMonths(day, n) {
  const d = toDate(day);
  const dom = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dom, last));
  return toDay(d);
}

// Days from `from` to `to` (positive when `to` is later).
function daysBetween(from, to) {
  return Math.round((toDate(to) - toDate(from)) / 86400000);
}

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toDay(toDate(s)) === s;

const frDay = (day) => (day ? day.split('-').reverse().join('/') : '');

module.exports = { parisDay, addDays, addMonths, daysBetween, isDay, frDay };
