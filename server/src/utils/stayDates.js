/**
 * The one guard on a stay's dates, shared by every internal write and quote: reservation create and
 * update, restoring a duplicate set aside, an approved iCal date drift, devis create / update / extend /
 * convert, and the price preview (specs/reservations-backend-mvc.md rule 11).
 *
 * Each date is `YYYY-MM-DD` and a real calendar day (`2027-02-30` is not), and the departure follows
 * the arrival. A reversed or zero-night stay priced at 0 € and freed its nights for a second booking,
 * and the iCal export published it as an invalid event (audit R18-1).
 */

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const INVALID_STAY_DATES = 'INVALID_STAY_DATES';
const DATE_INVALID_MESSAGE = 'Date de séjour invalide.';
const ORDER_MESSAGE = "La date de départ doit suivre la date d'arrivée.";

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
 * `null` when the stay's dates are sound, otherwise the refusal:
 * `{ status: 400, error, code: 'INVALID_STAY_DATES', field }`, `field` naming the date at fault.
 */
function stayDatesRefusal(startDate, endDate) {
  const refuse = (field, error) => ({ status: 400, error, code: INVALID_STAY_DATES, field });
  if (!isRealIsoDay(startDate)) return refuse('startDate', DATE_INVALID_MESSAGE);
  if (!isRealIsoDay(endDate)) return refuse('endDate', DATE_INVALID_MESSAGE);
  if (endDate <= startDate) return refuse('endDate', ORDER_MESSAGE);
  return null;
}

/** The HTTP body of a refusal: `{ error, code, field }`. */
function stayDatesRefusalBody(refusal) {
  return { error: refusal.error, code: refusal.code, field: refusal.field };
}

module.exports = {
  INVALID_STAY_DATES, DATE_INVALID_MESSAGE, ORDER_MESSAGE, isRealIsoDay, stayDatesRefusal, stayDatesRefusalBody,
};
