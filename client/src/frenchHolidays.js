// Compute Easter Sunday using the Meeus/Jones/Butcher algorithm
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
  return new Date(year, month - 1, day);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Returns a Set of "YYYY-MM-DD" strings for French public holidays
export function getFrenchPublicHolidays(year) {
  const easter = easterSunday(year);
  const holidays = new Set();
  // Fixed holidays
  holidays.add(`${year}-01-01`); // Jour de l'An
  holidays.add(`${year}-05-01`); // Fête du Travail
  holidays.add(`${year}-05-08`); // Victoire 1945
  holidays.add(`${year}-07-14`); // Fête nationale
  holidays.add(`${year}-08-15`); // Assomption
  holidays.add(`${year}-11-01`); // Toussaint
  holidays.add(`${year}-11-11`); // Armistice
  holidays.add(`${year}-12-25`); // Noël
  // Easter-based holidays
  holidays.add(fmt(addDays(easter, 1)));  // Lundi de Pâques
  holidays.add(fmt(addDays(easter, 39))); // Ascension
  holidays.add(fmt(addDays(easter, 50))); // Lundi de Pentecôte
  return holidays;
}

// Checks if dateStr falls within a school holiday period from dynamic data
// schoolHolidays: array of { zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end, label }
export function getSchoolHolidayInfo(dateStr, schoolHolidays) {
  for (const h of schoolHolidays) {
    const zones = [];
    if (h.zoneA_start && h.zoneA_end && dateStr >= h.zoneA_start && dateStr <= h.zoneA_end) zones.push('A');
    if (h.zoneB_start && h.zoneB_end && dateStr >= h.zoneB_start && dateStr <= h.zoneB_end) zones.push('B');
    if (h.zoneC_start && h.zoneC_end && dateStr >= h.zoneC_start && dateStr <= h.zoneC_end) zones.push('C');
    if (zones.length > 0) return { zones, label: h.label };
  }
  return null;
}
