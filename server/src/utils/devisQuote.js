/**
 * Recompute the pricing-engine quote for a PERSISTED devis, and derive the online full-payment amount.
 *
 * The engine is the single source of truth (specs/online-payments-qonto.md, public-online-payment.md):
 * stored `finalPrice`/`depositAmount` columns can be stale, so payment amounts are always re-run from
 * the saved devis graph. `finalPrice` is tax-EXCLUSIVE (accommodation + options + resources);
 * `totalStayPrice` adds the tourist tax. The public full payment charges the tax-inclusive total EXCEPT
 * when the tourist tax is collected on arrival (decision 2026-06-30).
 *
 * Every dependency is injected so this is unit-testable without the prod DB.
 */

// Build the engine input from a persisted devis row (same mapping the fiche/PDF use) and run it.
function recomputeDevisQuote({ database, devisModel, calc }, devisId) {
  const full = devisModel.findById(devisId);
  if (!full) return null;
  return calc({
    db: database,
    propertyId: Number(full.propertyId),
    startDate: full.startDate, endDate: full.endDate,
    checkInTime: full.checkInTime, checkOutTime: full.checkOutTime,
    adults: Number(full.adults || 0), children: Number(full.children || 0),
    teens: Number(full.teens || 0), babies: Number(full.babies || 0),
    discountPercent: Number(full.discountPercent || 0),
    customPrice: full.customPrice != null ? Number(full.customPrice) : undefined,
    selectedOptions: (full.options || []).filter((o) => !o.isCustom).map((o) => ({
      optionId: Number(o.optionId), quantity: Number(o.quantity || 1),
      unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
    })),
    customOptions: (full.options || []).filter((o) => o.isCustom).map((o) => ({
      customKey: String(o.customOptionId || o.title || ''),
      description: o.title || o.description || '',
      amount: Number(o.amount ?? o.originalTotalPrice ?? o.totalPrice ?? 0),
      offered: Boolean(o.offered),
    })),
    selectedResources: (full.resources || []).map((r) => ({
      resourceId: Number(r.resourceId), quantity: Number(r.quantity || 1),
      unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined, offered: Boolean(r.offered),
    })),
    platform: full.platform,
  });
}

// Cents to charge for a FULL online payment of a public devis = exactly what the guest agreed to on
// the quote: the **stored** `finalPrice` (accommodation + the options/resources THEY selected) + the
// **stored** `touristTaxTotal`, EXCEPT when the tax is collected on arrival → then `finalPrice` only.
//
// IMPORTANT: the amount must come from the SAVED devis, NOT a fresh engine recompute — a recompute can
// drift from the quote (e.g. the engine auto-adds a "Linge de lit" auto-option the public quote never
// showed), which would over-charge the guest. We re-run the engine ONLY to read the `collectedOnArrival`
// flag (a property-config boolean, never an amount). Falls back to the passed row on any failure.
function fullPaymentCents({ database, devisModel, calc }, devisId, fallbackRow) {
  const devis = (devisModel && typeof devisModel.findById === 'function' && devisModel.findById(devisId)) || fallbackRow || {};
  const finalPrice = Number(devis.finalPrice != null ? devis.finalPrice : (fallbackRow && fallbackRow.finalPrice) || 0);
  const tax = Number(devis.touristTaxTotal || 0);

  let collectedOnArrival = false;
  try {
    const q = recomputeDevisQuote({ database, devisModel, calc }, devisId);
    if (q) collectedOnArrival = Boolean(q.touristTaxCollectedOnArrival);
  } catch { /* default: tax included */ }

  const euros = finalPrice + (collectedOnArrival ? 0 : tax);
  return Math.round(euros * 100);
}

// Global VAT rate (single-rate model, specs/single-vat-rate.md). Falls back to 10 on any read failure.
function globalVatRate(database) {
  try {
    const row = database.prepare('SELECT vatRate FROM app_settings WHERE id = 1').get();
    return row && row.vatRate != null ? Number(row.vatRate) : 10;
  } catch { return 10; }
}

// VAT basket components for a public FULL payment (specs/payment-links-vat.md): the stay (accommodation
// + options + resources = the stored `finalPrice`, VAT-liable at the global rate) as one taxable line,
// plus the tourist tax as a 0 %-VAT line (VAT-exempt) — unless collected on arrival (then no tax line).
// Sum of components === fullPaymentCents by construction, so the charged total is unchanged.
function fullPaymentComponents({ database, devisModel, calc }, devisId, fallbackRow) {
  const devis = (devisModel && typeof devisModel.findById === 'function' && devisModel.findById(devisId)) || fallbackRow || {};
  const finalPrice = Number(devis.finalPrice != null ? devis.finalPrice : (fallbackRow && fallbackRow.finalPrice) || 0);
  const tax = Number(devis.touristTaxTotal || 0);

  let collectedOnArrival = false;
  try {
    const q = recomputeDevisQuote({ database, devisModel, calc }, devisId);
    if (q) collectedOnArrival = Boolean(q.touristTaxCollectedOnArrival);
  } catch { /* default: tax included */ }

  const components = [{ title: 'Séjour et prestations', grossCents: Math.round(finalPrice * 100), taxable: true }];
  if (!collectedOnArrival && tax > 0) {
    components.push({ title: 'Taxe de séjour', grossCents: Math.round(tax * 100), taxable: false });
  }
  return { components, vatRatePercent: globalVatRate(database) };
}

module.exports = { recomputeDevisQuote, fullPaymentCents, fullPaymentComponents };
