/**
 * The date window of a laundry write (specs/reservations-backend-mvc.md rule 13, reading of 2026-11-02): a
 * skip, a manual addition or an extra trip is entered on a day from today − 5 years to today + 5 years.
 * A date already stored is edited or cleared whatever its day — `stored` says so.
 */

const sdk = require('../sdk');

/** `null`, or the 400 body `{ error, code: 'DATE_OUTSIDE_WINDOW' }` of a real day outside the window. */
function outsideWindow(date, { stored = false } = {}) {
  if (stored) return null;
  const error = sdk.coreModule('stayDates').dateWindowMessage(date);
  return error ? { error, code: 'DATE_OUTSIDE_WINDOW' } : null;
}

module.exports = { outsideWindow };
