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

module.exports = { localIsoDate, todayIso };
