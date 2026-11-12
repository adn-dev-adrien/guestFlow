/**
 * The day it is on the server's clock (specs/finance-dashboard-redesign.md rule 37).
 *
 * The process runs in the accommodations' time zone (utils/serverTimezone.js sets `TZ`, Europe/Paris
 * by default), so the local calendar day is the operator's day. `toISOString()` is the UTC one: between
 * midnight and 01:00 / 02:00 in Paris it is still yesterday, which made « today » one day behind on the
 * finance page, the payment deadlines and the pace. Every server read of « today » goes through here.
 */

const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of `date` in the process's local time zone. */
function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today, `YYYY-MM-DD`, in the process's local time zone. */
function todayIso() {
  return localIsoDate(new Date());
}

/** `HH:MM` of `date` in the process's local time zone. */
function localHourMinute(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Whether a stay is over: its departure day is behind us, or it is today and the check-out time has passed
 * (specs/calendar-property-parity.md rule 3). A stay with no check-out time ends at its day's end.
 */
function stayHasEnded({ endDate, checkOutTime }, today, nowTime) {
  if (!endDate) return false;
  if (endDate !== today) return endDate < today;
  return /^\d{2}:\d{2}/.test(String(checkOutTime || '')) && String(checkOutTime).slice(0, 5) <= nowTime;
}

module.exports = { localIsoDate, todayIso, localHourMinute, stayHasEnded };
