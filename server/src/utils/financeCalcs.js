// Pure finance calculation helpers, extracted verbatim from routes/finance.js.
// Month assignment + accommodation-after-discount + tourist-tax glue. No DB, no req/res.

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

function computeAccommodationAmountAfterDiscount({ accommodationRawAmount, optionsTotal, resourcesTotal, finalPrice, accommodationVatRate, discountPercent = 0 }) {
  const raw = Math.max(0, Number(accommodationRawAmount || 0));
  const options = Math.max(0, Number(optionsTotal || 0));
  const resources = Math.max(0, Number(resourcesTotal || 0));
  const final = Math.max(0, Number(finalPrice || 0));
  const normalizedDiscountPercent = Math.max(0, Math.min(100, Number(discountPercent || 0)));
  const vatRate = Math.max(0, Number(accommodationVatRate || 0));
  const extras = options + resources;

  // Finance adjustments act only on the accommodation base.
  // If a discount is recorded, apply it to the accommodation raw amount.
  // For historical rows without an explicit discount, keep the raw amount unless the final total
  // looks like a recent accommodation+extras total (close to the raw amount after removing extras).
  let resolvedAccommodationTtc = raw;
  if (normalizedDiscountPercent > 0) {
    resolvedAccommodationTtc = round2(raw * (1 - normalizedDiscountPercent / 100));
  } else if (final > raw && final > 0 && extras > 0) {
    const candidate = Math.max(0, final - extras);
    const relativeFinal = raw > 0 ? final / raw : Infinity;
    if (candidate > 0 && relativeFinal <= 1.5) {
      resolvedAccommodationTtc = candidate;
    }
  }

  const accommodationTtcAmount = round2(Math.max(0, resolvedAccommodationTtc));
  const reductionAmount = round2(Math.max(0, raw - accommodationTtcAmount));
  const vatDivisor = 1 + (vatRate / 100);
  const accommodationHtAmount = round2(vatDivisor > 0 ? (accommodationTtcAmount / vatDivisor) : accommodationTtcAmount);
  return {
    accommodationRawAmount: round2(raw),
    reductionAmount,
    accommodationTtcAmount,
    accommodationAmount: accommodationHtAmount,
  };
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
  computeAccommodationAmountAfterDiscount,
  computeTouristTaxAmount,
};
