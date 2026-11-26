/**
 * How far ahead the public may book (specs/gift-vouchers/gift-voucher-campaigns.md rule 51).
 *
 * A horizon is « today + N months » on the server's clock — the process runs in the accommodations'
 * time zone (utils/localDate.js, Europe/Paris by default) — never a constant and never computed by a
 * client. The lodging's N is the `bookingHorizonMonths` setting; a resource carries its own. The
 * back-office is never bounded: only public routes ask for a horizon.
 */

const { localIsoDate } = require('./localDate');
const { formatDateLong, formatDateLongFr } = require('./dateFr');
const { errorMessage } = require('./publicLabels');

const DEFAULT_LODGING_MONTHS = 12;

/** `YYYY-MM-DD` + `months` calendar months; a day the target month lacks falls on its last day (31 Jan + 1 → 28 Feb). */
function addMonthsIso(iso, months) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + Number(months), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** The last day the public may book, `months` ahead of the day of `now`. */
function horizonUntil(months, now = new Date()) {
  return addMonthsIso(localIsoDate(now), months);
}

/** The lodging's horizon in months: the setting, 12 when it is unset or unreadable. */
function lodgingMonths(database = require('../database')) {
  try {
    const row = database.prepare('SELECT bookingHorizonMonths FROM app_settings WHERE id = 1').get();
    const months = Number(row && row.bookingHorizonMonths);
    return Number.isInteger(months) && months >= 1 ? months : DEFAULT_LODGING_MONTHS;
  } catch { return DEFAULT_LODGING_MONTHS; }
}

/** The last day the public may book a lodging. */
function lodgingHorizonUntil(now = new Date(), database) {
  return horizonUntil(lodgingMonths(database), now);
}

/** « Réservable jusqu'au 18 novembre 2027 » (`en`: « Bookable until 18 November 2027 »). */
function refusalSentence(untilIso, lang = 'fr') {
  return errorMessage(lang, 'beyondHorizon', lang === 'en' ? formatDateLong(untilIso, 'en') : formatDateLongFr(untilIso));
}

module.exports = {
  addMonthsIso, horizonUntil, lodgingMonths, lodgingHorizonUntil, refusalSentence, DEFAULT_LODGING_MONTHS,
};
