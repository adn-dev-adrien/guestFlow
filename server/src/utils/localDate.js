/**
 * The day it is on the server's clock (specs/accounting/finance-dashboard-redesign.md rule 37).
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

/** Today and the time of day from ONE clock read, so a request straddling midnight never mixes two days. `now`: the gesture's own moment. */
function localNow(now = new Date()) {
  return { today: localIsoDate(now), nowTime: localHourMinute(now) };
}

/**
 * Whether a stay is over: its departure day is behind us, or it is today and the check-out time has passed
 * (specs/planning/calendar-property-parity.md rule 3). A stay with no check-out time ends at its day's end.
 */
function stayHasEnded({ endDate, checkOutTime }, today, nowTime) {
  if (!endDate) return false;
  if (endDate !== today) return endDate < today;
  return /^\d{2}:\d{2}/.test(String(checkOutTime || '')) && String(checkOutTime).slice(0, 5) <= nowTime;
}

// Rule 102 — ONE moment per gesture. A caller that injects its `now` (a sale, the guest app's amend, a test at a given hour) runs the
// gesture inside `withNow(now, fn)`; every reader of the clock it reaches — the fiche lock, the extras window, the baseline, the sale
// detail — reads `gestureNow()`, never the wall clock. The core is synchronous (better-sqlite3), so the moment is held for the call.
let gestureMoment = null;
function withNow(now, fn) {
  const previous = gestureMoment;
  if (now != null) gestureMoment = new Date(now instanceof Date ? now.getTime() : now);
  try {
    return fn();
  } finally {
    gestureMoment = previous;
  }
}
const gestureNow = () => (gestureMoment ? new Date(gestureMoment.getTime()) : new Date());

module.exports = {
  localIsoDate, todayIso, localHourMinute, localNow, stayHasEnded, withNow, gestureNow,
};
