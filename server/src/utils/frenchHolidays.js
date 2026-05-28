// French public holidays — computed, never stored.
// Easter Sunday via the Meeus/Jones/Butcher algorithm; the movable feasts are derived from it.

function easterSunday(year) {
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

function addDays(date, n) {
  const r = new Date(date);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function fmt(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * French public holidays for a given year.
 * @param {number} year
 * @returns {{ date: string, label: string }[]} sorted ascending by date (`YYYY-MM-DD`).
 */
function getFrenchPublicHolidays(year) {
  const easter = easterSunday(year);
  const holidays = [
    { date: `${year}-01-01`, label: "Jour de l'An" },
    { date: fmt(addDays(easter, 1)), label: 'Lundi de Pâques' },
    { date: `${year}-05-01`, label: 'Fête du Travail' },
    { date: `${year}-05-08`, label: 'Victoire 1945' },
    { date: fmt(addDays(easter, 39)), label: 'Ascension' },
    { date: fmt(addDays(easter, 50)), label: 'Lundi de Pentecôte' },
    { date: `${year}-07-14`, label: 'Fête nationale' },
    { date: `${year}-08-15`, label: 'Assomption' },
    { date: `${year}-11-01`, label: 'Toussaint' },
    { date: `${year}-11-11`, label: 'Armistice 1918' },
    { date: `${year}-12-25`, label: 'Noël' },
  ];
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { getFrenchPublicHolidays };
