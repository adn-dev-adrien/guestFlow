/**
 * French public holidays (the week-weekend-and-print spec rule 6): the eleven fixed and movable days of the
 * metropolitan calendar — New Year, Easter Monday, Labour Day, Victory Day, Ascension, Whit Monday, Bastille Day, Assumption, All Saints,
 * Armistice, Christmas. Pure: no DB, no clock; every date is an ISO `YYYY-MM-DD` day.
 *
 *   publicHolidaysOf(year)          → ['2026-01-01', …] sorted
 *   isPublicHoliday(isoDate)        → boolean
 *   isEveOfPublicHoliday(isoDate)   → boolean — the day before a public holiday
 */

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const shifted = (date, days) => new Date(date.getTime() + days * 86400000);

// Meeus/Jones/Butcher algorithm: Easter Sunday of the Gregorian calendar.
function easterOf(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const cache = new Map();

function publicHolidaysOf(year) {
  const y = Number(year);
  if (!cache.has(y)) {
    const easter = easterOf(y);
    const fixed = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].map((md) => `${y}-${md}`);
    cache.set(y, [...fixed, isoOf(shifted(easter, 1)), isoOf(shifted(easter, 39)), isoOf(shifted(easter, 50))].sort());
  }
  return cache.get(y);
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function isPublicHoliday(isoDate) {
  const match = ISO.exec(String(isoDate || ''));
  return Boolean(match) && publicHolidaysOf(Number(match[1])).includes(String(isoDate));
}

function isEveOfPublicHoliday(isoDate) {
  const match = ISO.exec(String(isoDate || ''));
  if (!match) return false;
  const next = shifted(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))), 1);
  return isPublicHoliday(isoOf(next));
}

module.exports = { publicHolidaysOf, isPublicHoliday, isEveOfPublicHoliday };
