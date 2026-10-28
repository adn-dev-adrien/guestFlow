/**
 * Per-property public payment mode (specs/public-online-deposit.md). The SERVER decides — never the
 * client — whether a website guest pays the FULL stay now or an ACOMPTE now with the solde collected
 * later by an emailed link. Effective mode = 'deposit' when the property has `depositEnabled=1`
 * AND the computed deposit is > 0; else 'full'. Since specs/property-deposit-switch.md the second
 * condition can no longer fire on its own — the engine already zeroes the acompte of a disabled
 * property — but it stays as the defensive read for a missing column or an unknown property.
 *
 * The deposit amount charged online is the STORED devis `depositAmount` column (accommodation-based,
 * the tourist tax rides on the solde per specs/tourist-tax-on-solde.md) — read RAW, NOT via
 * devisModel.findById, which spreads a divergent tax-inclusive deposit over the row (enrichDevis).
 */

const vatRegimeModel = require('../models/vatRegimeModel');

// RAW stored deposit amount (cents) for a devis — the amount the guest agreed to on the quote.
function depositPaymentCents(database, devisId, fallbackRow) {
  const row = database.prepare('SELECT depositAmount FROM reservations WHERE id = ?').get(Number(devisId))
    || (fallbackRow ? { depositAmount: fallbackRow.depositAmount } : null);
  return Math.round(Number((row && row.depositAmount) || 0) * 100);
}

// 'deposit' when the property opted in AND there is a positive deposit; else 'full'. Defensive: any
// read failure (e.g. a minimal DB without the column) falls back to 'full' — never breaks the quote.
function resolvePublicPaymentMode(database, propertyId, depositCents) {
  if (Math.round(Number(depositCents || 0)) <= 0) return 'full';
  try {
    const p = database.prepare('SELECT depositEnabled FROM properties WHERE id = ?').get(Number(propertyId));
    return p && Number(p.depositEnabled) === 1 ? 'deposit' : 'full';
  } catch { return 'full'; }
}

// VAT basket components for a public DEPOSIT payment: accommodation-only → a single taxable line at the
// global rate (no tourist-tax line — the tax is on the solde). Sum === depositPaymentCents.
function depositPaymentComponents(database, devisId, fallbackRow) {
  const grossCents = depositPaymentCents(database, devisId, fallbackRow);
  return {
    components: [{ title: 'Acompte séjour', grossCents, taxable: true }],
    vatRatePercent: vatRegimeModel.rateForRow(database, { id: devisId }),
  };
}

// Part of the SDK contract (2.x): the rate of the regime in force today.
const globalVatRate = (database) => vatRegimeModel.rateForRow(database, null);

module.exports = { resolvePublicPaymentMode, depositPaymentCents, depositPaymentComponents, globalVatRate };
