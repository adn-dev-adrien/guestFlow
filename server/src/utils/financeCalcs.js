// Pure finance calculation helpers, extracted verbatim from routes/finance.js.
// Month assignment + tourist-tax glue. No DB, no req/res.
//
// `computeAccommodationAmountAfterDiscount` used to live here: the « Suivi taxe de séjour » page
// re-derived its own accommodation from SQL with it. It now replays the pricing engine instead
// (specs/tourist-tax-included-services-deduction.md rule 14), so the helper had no caller left.

const { computeTouristTaxBreakdown } = require('./pricing');

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getMonthBounds(monthStr) {
  if (!/^\d{4}-\d{2}$/.test(monthStr || '')) return null;
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
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
  const adultNights = breakdown.touristTaxNights * breakdown.touristTaxAdultsCount;
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
