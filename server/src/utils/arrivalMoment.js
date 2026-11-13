/**
 * When did the arrival actually happen? — specs/arrival-moment-is-the-check-in.md
 *
 * Several rules hinge on « the guest is in »: which complement an extra joins, and which heading an
 * unsettled complement reads under. They all used to test the CALENDAR (`startDate <= today`), which
 * is a different question. On the arrival day, before anyone has checked in, an option added by hand
 * was filed as « sold during the stay » and billed at check-out instead of at arrival.
 *
 * The arrival is an operator act — the check-in box, or the arrival SAS which sets its own timestamp.
 * Both are kept: the two flows are used side by side (24 and 17 stays respectively on the operator's
 * base), and either one means the guest is standing there.
 */

// The guest is in: the check-in was marked, or the arrival SAS was completed.
function hasGuestArrived(reservation) {
  const r = reservation || {};
  return Number(r.checkInDone || 0) === 1 || Boolean(r.arrivalSasDoneAt);
}

/**
 * Has the stay started? — specs/lock-at-arrival-time-and-arrival-complement-lines.md rule 1.
 * The fiche locks from here, not from midnight of the arrival day: before the guest is due the fiche is
 * a normal one. Started = a day before today, or the arrival day once its `checkInTime` has passed
 * (no `checkInTime` → from 00:00), or earlier when the arrival was marked.
 * @param {{ startDate?: string, checkInTime?: string }} row
 * @param {string} today   `YYYY-MM-DD`
 * @param {string} nowTime `HH:MM`
 */
function hasStayStarted(row, today, nowTime) {
  const start = row && row.startDate ? String(row.startDate).slice(0, 10) : '';
  if (!start || start > today) return false;
  if (start < today) return true;
  if (hasGuestArrived(row)) return true;
  // « 9:00 », « 09h00 » and « 16h » are read too; a time nobody can read starts the stay at 00:00 (as before).
  const match = String(row.checkInTime || '').match(/^(\d{1,2})[:h](\d{2})?/);
  return !match || `${match[1].padStart(2, '0')}:${match[2] || '00'}` <= nowTime;
}

module.exports = { hasGuestArrived, hasStayStarted };
