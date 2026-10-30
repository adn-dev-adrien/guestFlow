/**
 * French-locale date + time formatters for email templates
 * (specs/email-automation.md §3 rule 5 + §4.4).
 *
 * Pure: ISO strings in, formatted strings out. Empty / malformed input → empty string
 * (the renderer is fail-safe; an unknown date in a template should never break the send).
 */

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// `2026-06-15` → `15 juin 2026` (fr) / `15 June 2026` (en). Truncates the time portion if present.
// `lang` defaults to 'fr' so every existing caller keeps today's output (specs/email-language-fr-en.md).
function formatDateLong(isoDate, lang = 'fr') {
  if (!isoDate) return '';
  const [datePart] = String(isoDate).split('T');
  const [y, m, d] = datePart.split('-');
  const monthIdx = Number(m) - 1;
  const dayNum = Number(d);
  const yearNum = Number(y);
  if (!Number.isInteger(monthIdx) || monthIdx < 0 || monthIdx > 11) return '';
  if (!Number.isInteger(dayNum) || dayNum <= 0 || dayNum > 31) return '';
  if (!Number.isInteger(yearNum) || yearNum < 1000) return '';
  const months = lang === 'en' ? EN_MONTHS : FR_MONTHS;
  return `${dayNum} ${months[monthIdx]} ${yearNum}`;
}

// `15:00:00` or `15:00` → `15:00`. Empty / malformed → empty string.
function formatTimeShort(value) {
  if (!value) return '';
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) return '';
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const FR_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// `2026-10-21` → `mercredi 21 octobre` — a day of the coming weeks; its year is said only when it is
// not `currentYear` (« lundi 4 janvier 2027 »).
function weekdayLabel(isoDate, currentYear = null) {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const day = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(day.getTime()) || m < 1 || m > 12) return '';
  const year = currentYear != null && Number(currentYear) !== y ? ` ${y}` : '';
  return `${FR_WEEKDAYS[day.getUTCDay()]} ${d === 1 ? '1er' : d} ${FR_MONTHS[m - 1]}${year}`;
}

const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PARIS_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

// An instant (ISO, UTC) as a guest reads it in an e-mail, Paris time, without the year: « lundi 2 novembre
// à 18 h 00 » / « Monday 2 November at 6:00 pm » (specs/payment-link-lifecycle.md rule 36). Empty for no
// instant, an unreadable one or Qonto's zero-time sentinel (anything at or before the Unix epoch).
function formatMomentLong(instant, lang = 'fr') {
  const ms = instant ? Date.parse(String(instant)) : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const part = Object.fromEntries(PARIS_PARTS.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
  const weekday = new Date(Date.UTC(part.year, part.month - 1, part.day)).getUTCDay();
  const minutes = String(part.minute).padStart(2, '0');
  if (lang === 'en') {
    const hour12 = part.hour % 12 === 0 ? 12 : part.hour % 12;
    return `${EN_WEEKDAYS[weekday]} ${part.day} ${EN_MONTHS[part.month - 1]} at ${hour12}:${minutes} ${part.hour < 12 ? 'am' : 'pm'}`;
  }
  return `${FR_WEEKDAYS[weekday]} ${part.day === 1 ? '1er' : part.day} ${FR_MONTHS[part.month - 1]} à ${part.hour} h ${minutes}`;
}

module.exports = {
  formatDateLong,
  formatMomentLong,
  weekdayLabel,
  formatTimeShort,
  FR_MONTHS,
  EN_MONTHS,
};
