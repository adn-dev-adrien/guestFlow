/**
 * Small pure helpers for the reservations domain (no DB access).
 */

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// An iCal-sourced reservation becomes sync-locked after a manual edit; manual reservations keep
// their existing lock flag.
function computeNextIcalSyncLocked(existingReservation) {
  if (!existingReservation) return 0;
  if (String(existingReservation.sourceType || '') === 'ical') return 1;
  return Number(existingReservation.icalSyncLocked || 0);
}

// Recover the manually-set accommodation price from stored totals, or '' when the final price simply
// matches the discount formula (i.e. no explicit manual override).
function inferCustomAccommodationPrice({
  totalPrice,
  finalPrice,
  discountPercent,
  optionsTotal,
  resourcesTotal,
}) {
  const baseTotal = Number(totalPrice);
  const storedFinal = Number(finalPrice);
  if (!Number.isFinite(baseTotal) || !Number.isFinite(storedFinal)) return '';

  const options = Number(optionsTotal || 0);
  const resources = Number(resourcesTotal || 0);
  const subtotal = roundMoney(baseTotal + options + resources);
  const normalizedDiscountPercent = Math.max(0, Math.min(100, Number(discountPercent || 0)));
  const discountedFinal = roundMoney(subtotal * (1 - normalizedDiscountPercent / 100));

  if (Math.abs(storedFinal - discountedFinal) < 0.01) return '';

  const accommodationCustomPrice = roundMoney(storedFinal - options - resources);
  return Number.isFinite(accommodationCustomPrice)
    ? Math.max(0, accommodationCustomPrice)
    : '';
}

module.exports = {
  parseJsonArray,
  roundMoney,
  getTodayIsoDate,
  computeNextIcalSyncLocked,
  inferCustomAccommodationPrice,
};
