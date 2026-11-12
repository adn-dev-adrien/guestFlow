// Pure finance calculation helpers, extracted verbatim from routes/finance.js.
// Month assignment + tourist-tax glue. No DB, no req/res.
//
// `computeAccommodationAmountAfterDiscount` used to live here: the « Suivi taxe de séjour » page
// re-derived its own accommodation from SQL with it. It now replays the pricing engine instead
// (specs/tourist-tax-included-services-deduction.md rule 14), so the helper had no caller left.

const { computeTouristTaxBreakdown } = require('./pricing');
const { personNights } = require('./pricing/touristTax');

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// specs/tourist-tax-report-v2.md rule 27 — a year before 1000 (Date.UTC reads 0-99 as 1900+, 100-999 lose their
// padding) or a month whose next one leaves four digits names no month a stay can be in: refused, never stretched.
function getMonthBounds(monthStr) {
  if (!/^\d{4}-\d{2}$/.test(monthStr || '')) return null;
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || y < 1000 || !m || m < 1 || m > 12 || (y === 9999 && m === 12)) return null;
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const nextMonthDate = new Date(Date.UTC(y, m, 1));
  const endExclusive = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { start, endExclusive };
}

function getLastNightDate(endDate) {
  const end = new Date(`${String(endDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return '';
  end.setUTCDate(end.getUTCDate() - 1);
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
}

function isReservationAssignedToMonth({ endDate, monthBounds }) {
  if (!monthBounds?.start || !monthBounds?.endExclusive) return false;
  const lastNightDate = getLastNightDate(endDate);
  if (!lastNightDate) return false;
  return lastNightDate >= monthBounds.start && lastNightDate < monthBounds.endExclusive;
}

function computeTouristTaxAmount({ nightsCount, adults, taxRate }) {
  const breakdown = computeTouristTaxBreakdown({
    touristTaxMode: 'per_day_per_person',
    touristTaxPerDayPerPerson: Number(taxRate || 0),
    nights: Number(nightsCount || 0),
    adults: Number(adults || 0),
    occupants: Number(adults || 0),
    accommodationAmountTtc: 0,
    accommodationVatRate: 0,
  });
  const adultNights = personNights(breakdown.touristTaxNights, breakdown.touristTaxAdultsCount);
  return {
    adultNights,
    taxAmount: round2(breakdown.touristTaxTotal),
  };
}

module.exports = {
  round2,
  getMonthBounds,
  getLastNightDate,
  isReservationAssignedToMonth,
  computeTouristTaxAmount,
};
