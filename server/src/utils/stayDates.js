/**
 * The one guard on a stay's dates, shared by every internal write and quote: reservation create and
 * update, restoring a duplicate set aside, an approved iCal date drift, devis create / update / extend /
 * convert, and the price preview (specs/reservations-backend-mvc.md rule 11).
 *
 * Each date is `YYYY-MM-DD` and a real calendar day (`2027-02-30` is not), and the departure follows
 * the arrival. A reversed or zero-night stay priced at 0 € and freed its nights for a second booking,
 * and the iCal export published it as an invalid event (audit R18-1). The stay lasts at most
 * `MAX_STAY_NIGHTS`: pricing walks the stay night by night, synchronously, so a departure typed as
 * 9999-12-31 froze the whole server for ~100 s (audit R19-L1). And no date is entered outside the window
 * [today − MAX_HORIZON_YEARS, today + MAX_HORIZON_YEARS] (rule 13): a date the operator types or edits,
 * never one a stored row already carries. `entryDateMessage` is the same window for every other date an
 * operator enters (payment marks, due dates, refunds, compensations, plugin dates…), and
 * `stayItemDatesRefusal` keeps the option occurrences and hourly sessions of a stay on its own days.
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
/** The past side of the window — Adrien's decision of 2026-11-02, second reading of rule 13. */
const PAST_HORIZON_MESSAGE = `Date trop ancienne : ${MAX_HORIZON_YEARS} ans au plus.`;
const ENTRY_DATE_INVALID_MESSAGE = 'Date invalide.';
const ITEM_OUTSIDE_STAY_MESSAGE = 'Date hors du séjour.';

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

/** `today` shifted by `years` years, a 29 February landing on the 28th. */
function shiftYears(today, years) {
  const sameDay = `${Number(today.slice(0, 4)) + years}${today.slice(4)}`;
  return isRealIsoDay(sameDay) ? sameDay : `${sameDay.slice(0, 8)}28`;
}

/** The last day a date may name: `today` (the Europe/Paris day by default) plus MAX_HORIZON_YEARS years. */
function horizonEnd(today = todayIso()) {
  return shiftYears(today, MAX_HORIZON_YEARS);
}

/** The first day a date may name: `today` minus MAX_HORIZON_YEARS years. */
function horizonStart(today = todayIso()) {
  return shiftYears(today, -MAX_HORIZON_YEARS);
}

/** Whether `iso`, a real day, lies past the horizon's end. */
function dateBeyondHorizon(iso, today = todayIso()) {
  return isRealIsoDay(iso) && iso > horizonEnd(today);
}

/** Whether `iso`, a real day, lies before the horizon's start. */
function dateBeforeHorizon(iso, today = todayIso()) {
  return isRealIsoDay(iso) && iso < horizonStart(today);
}

/** The refusal of a real day outside the window — the past or the future message — or `null` inside it. */
function dateWindowMessage(iso, today = todayIso()) {
  if (dateBeforeHorizon(iso, today)) return PAST_HORIZON_MESSAGE;
  if (dateBeyondHorizon(iso, today)) return HORIZON_MESSAGE;
  return null;
}

/**
 * The guard on any other date an operator enters: `null` when `value` is a real `YYYY-MM-DD` day inside the
 * window, or equal to `stored` (the value the row already carries, which is never re-judged), otherwise
 * the short French refusal.
 */
function entryDateMessage(value, { stored, today = todayIso(), invalidMessage = ENTRY_DATE_INVALID_MESSAGE } = {}) {
  if (stored !== undefined && stored !== null && value === stored) return null;
  if (!isRealIsoDay(value)) return invalidMessage;
  return dateWindowMessage(value, today);
}

/**
 * The guard on a list of `{ startDate, endDate }` ranges an operator enters (a season's date ranges):
 * `null` when every date is a real day inside the window, or one of the `stored` ranges' dates (a range
 * kept as it was), otherwise the refusal message.
 */
function rangesWindowMessage(ranges, { stored = [], today = todayIso(), invalidMessage = 'Dates invalides.' } = {}) {
  const kept = new Set(stored.flatMap((r) => [r && r.startDate, r && r.endDate]).filter(Boolean));
  for (const range of ranges) {
    for (const value of [range.startDate, range.endDate]) {
      if (kept.has(value)) continue;
      const message = entryDateMessage(value, { today, invalidMessage });
      if (message) return message;
    }
  }
  return null;
}

/**
 * `null` when the stay's dates are sound, otherwise the refusal:
 * `{ status: 400, error, code: 'INVALID_STAY_DATES', field }`, `field` naming the date at fault.
 * `stored` is the row being saved (`{ startDate, endDate }`): a date equal to its stored value is not
 * held to the window, so a row written before rule 13 still saves as long as its dates are not edited.
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
    const outside = dateWindowMessage(value, today);
    if (outside) return refuse(field, outside);
  }
  return null;
}

/** A stored JSON list (`cardOccurrences`, `sessions`) or an array, as an array. */
function listOf(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * `null` when every option occurrence and hourly session of the lines is dated on a day of the stay, arrival
 * to departure morning inclusive (the fiche's grid), otherwise the refusal
 * `{ status: 400, error: 'Date hors du séjour.', code: 'INVALID_STAY_DATES', field: 'cardOccurrences' | 'sessions' }`.
 * `stored` (`{ options: { [optionId]: dates }, resources: { [resourceId]: dates } }`, the edited row's lines)
 * exempts a date the same line already stores. The stay itself lies in the window, so this holds D6 too.
 */
function stayItemDatesRefusal({ options = [], resources = [], startDate, endDate, stored = null } = {}) {
  const outside = (date) => !isRealIsoDay(date) || date < startDate || date > endDate;
  const groups = [
    ['cardOccurrences', options, 'optionId', 'options'],
    ['sessions', resources, 'resourceId', 'resources'],
  ];
  for (const [field, lines, idKey, storedKey] of groups) {
    for (const line of Array.isArray(lines) ? lines : []) {
      const kept = new Set((stored && stored[storedKey] && stored[storedKey][Number(line && line[idKey])]) || []);
      for (const item of listOf(line && line[field])) {
        const raw = String((item && item.date) || '');
        const date = field === 'cardOccurrences' ? raw.slice(0, 10) : raw;
        if (kept.has(date)) continue;
        if (outside(date)) return { status: 400, error: ITEM_OUTSIDE_STAY_MESSAGE, code: INVALID_STAY_DATES, field };
      }
    }
  }
  return null;
}

/** The HTTP body of a refusal: `{ error, code, field }`. */
function stayDatesRefusalBody(refusal) {
  return { error: refusal.error, code: refusal.code, field: refusal.field };
}

module.exports = {
  INVALID_STAY_DATES, DATE_INVALID_MESSAGE, ORDER_MESSAGE, TOO_LONG_MESSAGE, MAX_STAY_NIGHTS,
  MAX_HORIZON_YEARS, HORIZON_MESSAGE, PAST_HORIZON_MESSAGE, ENTRY_DATE_INVALID_MESSAGE, ITEM_OUTSIDE_STAY_MESSAGE,
  horizonEnd, horizonStart, dateBeyondHorizon, dateBeforeHorizon, dateWindowMessage, entryDateMessage, rangesWindowMessage,
  isRealIsoDay, stayDatesRefusal, stayDatesRefusalBody, stayItemDatesRefusal,
};
