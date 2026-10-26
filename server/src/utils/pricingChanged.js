/**
 * `pricing.changed { propertyId | null, source }` — announced after a successful write that can move
 * a price, a minimum stay, a changeover day or a closed night (specs/google-vacation-rentals-feed.md
 * rule 12). Inert while no plugin listens. `null` = every property (an establishment-wide closure,
 * an option of the shared catalogue).
 */

const eventBus = require('../plugins/sdk/eventBus');
const database = require('../database');

// The property columns the quote engine prices with: a property update that leaves them alone moves
// no price.
const PRICE_BEARING_COLUMNS = Object.freeze([
  'maxGuests', 'basePriceIncludedGuests', 'extraGuestPrice', 'extraGuestPriceUnit',
  'defaultCheckIn', 'defaultCheckOut',
  'touristTaxPerDayPerPerson', 'touristTaxMode', 'touristTaxPercentage',
  'touristTaxDepartmentPercentage', 'touristTaxFixedAmount',
]);

function emitPricingChanged(propertyId, source) {
  const id = propertyId == null || propertyId === '' ? null : Number(propertyId);
  eventBus.emit('pricing.changed', { propertyId: Number.isInteger(id) && id > 0 ? id : null, source: String(source || '') });
}

/** The price-bearing columns of a property as stored now, or null when it does not exist. */
function priceBearingRow(propertyId, db = database) {
  return db.prepare(`SELECT ${PRICE_BEARING_COLUMNS.join(', ')} FROM properties WHERE id = ?`).get(Number(propertyId)) || null;
}

function priceBearingChanged(before, after) {
  if (!before || !after) return Boolean(before) !== Boolean(after);
  return PRICE_BEARING_COLUMNS.some((key) => String(before[key] ?? '') !== String(after[key] ?? ''));
}

module.exports = { emitPricingChanged, priceBearingRow, priceBearingChanged, PRICE_BEARING_COLUMNS };
