/**
 * Public holidays controller — returns French public-holiday dates for the requested years.
 * Stateless: dates are computed on demand (see utils/frenchHolidays).
 */

const { getFrenchPublicHolidays } = require('../utils/frenchHolidays');

const MIN_YEAR = 1970;
const MAX_YEAR = 2200;
const MAX_YEARS = 20;

function parseYears(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'MISSING_YEARS' };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { error: 'MISSING_YEARS' };
  const years = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) return { error: 'INVALID_YEAR' };
    if (!years.includes(n)) years.push(n);
  }
  if (years.length > MAX_YEARS) return { error: 'TOO_MANY_YEARS' };
  return { years };
}

function list(req, res) {
  const { years, error } = parseYears(req.query.years);
  if (error) return res.status(400).json({ error });
  const holidays = years.flatMap((y) => getFrenchPublicHolidays(y));
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  res.json(holidays);
}

module.exports = { list };
