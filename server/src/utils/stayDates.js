/**
 * The one guard on a stay's dates, shared by every internal write and quote: reservation create and
 * update, restoring a duplicate set aside, an approved iCal date drift, devis create / update / extend /
 * convert, and the price preview (specs/reservations-backend-mvc.md rule 11).
 *
 * Each date is `YYYY-MM-DD` and a real calendar day (`2027-02-30` is not), and the departure follows
 * the arrival. A reversed or zero-night stay priced at 0 € and freed its nights for a second booking,
 * and the iCal export published it as an invalid event (audit R18-1). The stay lasts at most
 * `MAX_STAY_NIGHTS`: pricing walks the stay night by night, synchronously, so a departure typed as
 * 9999-12-31 froze the whole server for ~100 s (audit R19-L1). And no date is entered past the horizon,
 * today + MAX_HORIZON_YEARS (rule 13): a date the operator types or edits, never one a stored row
 * already carries.
 */

const { todayIso } = require('./localDate');

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const INVALID_STAY_DATES = 'INVALID_STAY_DATES';
const DATE_INVALID_MESSAGE = 'Date de séjour invalide.';
const ORDER_MESSAGE = "La date de départ doit suivre la date d'arrivée.";
const TOO_LONG_MESSAGE = 'Séjour trop long.';
/** specs/reservations-backend-mvc.md rule 13 — Adrien's decision of 2026-11-02. */
const MAX_HORIZON_YEARS = 5;
const HORIZON_MESSAGE = `Date trop lointaine : ${MAX_HORIZON_YEARS} ans au plus.`;

/** The longest stay, in nights. The iCal parser drops a longer event with this same constant. */
const MAX_STAY_NIGHTS = 366;
const DAY_MS = 86400000;

/**
 * Whether `value` is a `YYYY-MM-DD` string naming a day of the calendar (UTC round-trip). The core's one
 * copy: `planningDateRange.isIsoDate` and `cancellationCompensations.isValidIsoDate` are this function.
 */
function isRealIsoDay(value) {
  if (typeof value !== 'string' || !ISO_DAY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The last day a date may name: `today` (the Europe/Paris day by default) plus MAX_HORIZON_YEARS years,
 * a 29 February landing on the 28th.
 */
function horizonEnd(today = todayIso()) {
  const sameDay = `${Number(today.slice(0, 4)) + MAX_HORIZON_YEARS}${today.slice(4)}`;
  return isRealIsoDay(sameDay) ? sameDay : `${sameDay.slice(0, 8)}28`;
}

/** Whether `iso`, a real day, lies past the horizon. The past is never limited. */
function dateBeyondHorizon(iso, today = todayIso()) {
  return isRealIsoDay(iso) && iso > horizonEnd(today);
}

/**
 * `null` when the stay's dates are sound, otherwise the refusal:
 * `{ status: 400, error, code: 'INVALID_STAY_DATES', field }`, `field` naming the date at fault.
 * `stored` is the row being saved (`{ startDate, endDate }`): a date equal to its stored value is not
 * held to the horizon, so a row written before rule 13 still saves as long as its dates are not edited.
 */
function stayDatesRefusal(startDate, endDate, { stored = null, today = todayIso() } = {}) {
  const refuse = (field, error) => ({ status: 400, error, code: INVALID_STAY_DATES, field });
  if (!isRealIsoDay(startDate)) return refuse('startDate', DATE_INVALID_MESSAGE);
  if (!isRealIsoDay(endDate)) return refuse('endDate', DATE_INVALID_MESSAGE);
  if (endDate <= startDate) return refuse('endDate', ORDER_MESSAGE);
  if ((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS > MAX_STAY_NIGHTS) {
    return refuse('endDate', TOO_LONG_MESSAGE);
  }
  for (const [field, value] of [['startDate', startDate], ['endDate', endDate]]) {
    if (stored && stored[field] === value) continue;
    if (dateBeyondHorizon(value, today)) return refuse(field, HORIZON_MESSAGE);
  }
  return null;
}

/** The HTTP body of a refusal: `{ error, code, field }`. */
function stayDatesRefusalBody(refusal) {
  return { error: refusal.error, code: refusal.code, field: refusal.field };
}

module.exports = {
  INVALID_STAY_DATES, DATE_INVALID_MESSAGE, ORDER_MESSAGE, TOO_LONG_MESSAGE, MAX_STAY_NIGHTS,
  MAX_HORIZON_YEARS, HORIZON_MESSAGE, horizonEnd, dateBeyondHorizon,
  isRealIsoDay, stayDatesRefusal, stayDatesRefusalBody,
};
