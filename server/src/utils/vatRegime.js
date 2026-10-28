/**
 * The pure rules of the VAT regime (specs/vat-optional-mode.md): the two legal mentions, which period a
 * sale falls under, and the bounds of a switch. No database here: `models/vatRegimeModel.js` reads and
 * writes, this decides. The assignment predicate has a SQL twin (the trigger of `vatRegimeMigration.js`);
 * `vat-regime-assignment.unit.test.js` runs both on the same matrix.
 */

const { localIsoDate } = require('./localDate');

const REGIMES = Object.freeze({ SUBJECT: 'subject', NOT_SUBJECT: 'not_subject' });
const BASES = Object.freeze({ ALL: 'all', BOOKING: 'booking', ARRIVAL: 'arrival' });

// Rule 2 — chosen, not typed. FR and EN, server constants.
const MENTIONS = Object.freeze({
  art_293_b: {
    fr: 'TVA non applicable, art. 293 B du CGI',
    en: 'VAT not applicable, art. 293 B of the French General Tax Code',
  },
  art_261_d_4: {
    fr: 'Exonération de TVA, art. 261 D 4° du CGI',
    en: 'VAT exempt, art. 261 D 4° of the French General Tax Code',
  },
});
const DEFAULT_MENTION = 'art_293_b';

const isMentionKey = (key) => Object.prototype.hasOwnProperty.call(MENTIONS, key);

function mentionText(key, lang = 'fr') {
  if (!isMentionKey(key)) return null;
  return String(lang).toLowerCase() === 'en' ? MENTIONS[key].en : MENTIONS[key].fr;
}

/**
 * The calendar day in the server's time zone of a stored timestamp: SQLite writes `datetime('now')` in
 * UTC, so this is the JS twin of `date(createdAt, 'localtime')`. A bare date is already a day.
 */
function bookingDayOf(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text);
  const date = new Date(hasZone ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : localIsoDate(date);
}

/** Rule 5 — whether a period applies to a sale. */
function appliesTo(period, { bookingDay, startDate }) {
  if (period.basis === BASES.ALL) return true;
  if (period.basis === BASES.BOOKING) return Boolean(bookingDay) && bookingDay >= period.effectiveFrom;
  if (period.basis === BASES.ARRIVAL) return Boolean(startDate) && String(startDate) >= period.effectiveFrom;
  return false;
}

/** Rule 5 — the latest period (highest id) that applies; the first one when none does. */
function pickPeriod(periods, sale) {
  const ordered = [...periods].sort((a, b) => b.id - a.id);
  return ordered.find((p) => appliesTo(p, sale)) || ordered[ordered.length - 1] || null;
}

/** The regime object every reader receives (rule 8). */
function toRegime(period) {
  if (!period) return null;
  return {
    periodId: period.id,
    regime: period.regime,
    rate: Number(period.rate),
    legalMention: period.legalMention || null,
    legalMentionText: mentionText(period.legalMention, 'fr'),
    legalMentionTextEn: mentionText(period.legalMention, 'en'),
  };
}

module.exports = {
  REGIMES, BASES, MENTIONS, DEFAULT_MENTION,
  isMentionKey, mentionText, bookingDayOf, appliesTo, pickPeriod, toRegime,
};
