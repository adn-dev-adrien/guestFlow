/**
 * Per-property public payment mode (specs/public-online-deposit.md). The SERVER decides — never the
 * client — whether a website guest pays the FULL stay now or an ACOMPTE now with the solde collected
 * later by an emailed link. Effective mode = 'deposit' when the property has `publicDepositEnabled=1`
 * AND the computed deposit is > 0; else 'full'.
 *
 * The deposit amount charged online is the STORED devis `depositAmount` column (accommodation-based,
 * the tourist tax rides on the solde per specs/tourist-tax-on-solde.md) — read RAW, NOT via
 * devisModel.findById, which spreads a divergent tax-inclusive deposit over the row (enrichDevis).
 */

// Global VAT rate (single-rate model). Falls back to 10 on any read failure.
function globalVatRate(database) {
  try {
    const row = database.prepare('SELECT vatRate FROM app_settings WHERE id = 1').get();
    return row && row.vatRate != null ? Number(row.vatRate) : 10;
  } catch { return 10; }
}

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
    const p = database.prepare('SELECT publicDepositEnabled FROM properties WHERE id = ?').get(Number(propertyId));
    return p && Number(p.publicDepositEnabled) === 1 ? 'deposit' : 'full';
  } catch { return 'full'; }
}

// VAT basket components for a public DEPOSIT payment: accommodation-only → a single taxable line at the
// global rate (no tourist-tax line — the tax is on the solde). Sum === depositPaymentCents.
function depositPaymentComponents(database, devisId, fallbackRow) {
  const grossCents = depositPaymentCents(database, devisId, fallbackRow);
  return {
    components: [{ title: 'Acompte séjour', grossCents, taxable: true }],
    vatRatePercent: globalVatRate(database),
  };
}

module.exports = { resolvePublicPaymentMode, depositPaymentCents, depositPaymentComponents, globalVatRate };
