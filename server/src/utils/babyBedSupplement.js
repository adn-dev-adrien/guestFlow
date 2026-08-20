/**
 * Baby-bed supplement rule (specs/baby-bed-supplement.md).
 *
 * A cot entered on a booking (`reservations.babyBeds`) bills a flat amount PER COT for the WHOLE
 * stay — 5 € by default, re-priceable per logement. The line is derived by the pricing engine from
 * the catalogue option flagged `autoOptionType = 'baby_bed'` + `autoEnabled = 1`, exactly like the
 * early-check-in / late-check-out lines: it never travels in `selectedOptions` and cannot be ticked.
 *
 * Two rules live here, both money-critical:
 *   - how much a cot costs (§3.1 rules 3-5, §3.4 rule 15)
 *   - which bookings are exempt (§3.3 rules 10-14) — everything already stored with cots and no
 *     supplement line predates the feature and must never move.
 *
 * `roundTwo` is local on purpose: `utils/pricing.js` consumes this module, so requiring it back for
 * `roundMoney` would close a cycle.
 */

const AUTO_OPTION_TYPE = 'baby_bed';

function roundTwo(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** The catalogue row this feature is driven by — the type alone is not enough, the engine only ever
 * derives options it owns (`autoEnabled = 1`). */
function isBabyBedOption(option) {
  return Boolean(option)
    && String(option.autoOptionType || '') === AUTO_OPTION_TYPE
    && Number(option.autoEnabled || 0) === 1;
}

function findBabyBedOption(options) {
  return (options || []).find(isBabyBedOption) || null;
}

/** Cots are whole beds: anything not a positive integer counts as none. */
function normalizeBabyBedCount(value) {
  const n = Math.floor(Number(value || 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * § 3.3 — « grandfathered »: a booking (reservation OR devis) already stored WITH cots and WITHOUT a
 * supplement line was sold before the supplement existed. It never gets one, on any recompute.
 *
 * The verdict is read from the database, so the live preview and the save agree, and it survives a
 * devis → réservation conversion for free (the conversion copies the line graph verbatim: stored
 * cots, no line → still grandfathered).
 *
 * A booking with 0 stored cot is NOT grandfathered (rule 11): adding a cot to it is a new sale.
 * An unsaved booking has no id, hence no exemption (rule 13).
 */
function isBabyBedSupplementGrandfathered(database, bookingId, optionId) {
  const id = Number(bookingId || 0);
  const option = Number(optionId || 0);
  if (!database || !Number.isFinite(id) || id <= 0 || !Number.isFinite(option) || option <= 0) return false;
  try {
    const booking = database.prepare('SELECT babyBeds FROM reservations WHERE id = ?').get(id);
    if (!booking) return false;
    if (normalizeBabyBedCount(booking.babyBeds) === 0) return false;
    const line = database
      .prepare('SELECT 1 AS present FROM reservation_options WHERE reservationId = ? AND optionId = ?')
      .get(id, option);
    return !line;
  } catch {
    // Minimal test schema without one of the tables — nothing to grandfather.
    return false;
  }
}

/**
 * The cot count the engine is allowed to bill: the current count, or 0 when the booking predates
 * the supplement. Single entry point for callers that hold a `db` handle.
 */
function resolveBillableBabyBeds({ database, bookingId, option, babyBeds }) {
  const count = normalizeBabyBedCount(babyBeds);
  if (count === 0 || !isBabyBedOption(option)) return 0;
  return isBabyBedSupplementGrandfathered(database, bookingId, Number(option.id)) ? 0 : count;
}

/**
 * The engine line for the supplement, or `null` when there is nothing to bill.
 *
 * `unitPrice` is resolved by the caller so a SAVED booking keeps the price it was sold at (the
 * pricing snapshot wins over today's catalogue, §3.4 rule 15) while the quantity always follows the
 * current cot count (rule 12). A unit price of 0 produces NO line at all (rule 4): a logement that
 * does not charge for cots shows nothing rather than a 0,00 € row.
 */
function buildBabyBedSupplementLine({ option, babyBeds, unitPrice }) {
  if (!isBabyBedOption(option)) return null;
  const quantity = normalizeBabyBedCount(babyBeds);
  if (quantity === 0) return null;
  const price = roundTwo(unitPrice != null ? unitPrice : option.price);
  if (price <= 0) return null;

  return {
    optionId: Number(option.id),
    title: option.title,
    quantity,
    unitPrice: price,
    // Per cot, for the stay: the catalogue `priceType` is deliberately NOT applied (§3.1 rule 3).
    billedUnits: quantity,
    priceType: 'per_stay',
    totalPrice: roundTwo(price * quantity),
    autoOptionType: AUTO_OPTION_TYPE,
  };
}

module.exports = {
  AUTO_OPTION_TYPE,
  isBabyBedOption,
  findBabyBedOption,
  normalizeBabyBedCount,
  isBabyBedSupplementGrandfathered,
  resolveBillableBabyBeds,
  buildBabyBedSupplementLine,
};
