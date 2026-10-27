/**
 * Recompute the pricing-engine quote for a PERSISTED devis, and derive the online full-payment amount.
 *
 * The engine is the single source of truth (specs/online-payments-qonto.md, public-online-payment.md):
 * stored `finalPrice`/`depositAmount` columns can be stale, so payment amounts are always re-run from
 * the saved devis graph. The public full payment charges the stored acompte + solde — the pre-arrival
 * amount, tourist tax included unless it is collected on arrival (decision 2026-06-30), arrival
 * complement excluded (decision 2026-10-27).
 *
 * Every dependency is injected so this is unit-testable without the prod DB.
 */

// Build the engine input from a persisted devis row and run it.
//
// NOT the full replay of the sold state: this mapping drops `offeredOptionIds` and the price-lock
// snapshot, so its AMOUNTS can drift from the fiche (specs/devis-pdf-total-parity.md §1). That is
// harmless here and here only — the caller below reads exactly one boolean from the result
// (`touristTaxCollectedOnArrival`, a property-config flag) and takes every euro from the stored row.
// Any consumer that needs the devis's actual quote must call `devisModel.recomputeQuote(id)`.
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
      // The scheduled hours have to ride along: without them the engine re-prices an hourly resource
      // from its quantity alone and the recompute silently diverges from the stored devis
      // (specs/hourly-resource-quantity-and-sas-scheduling.md §1 defect 3). The PDF path always
      // passed them; this one did not.
      sessions: Array.isArray(r.sessions) ? r.sessions : [],
    })),
    platform: full.platform,
    // A public devis prices planning-card options by quantity (specs/public-planning-options.md), so the
    // recompute must match the stored devis (else it would drop them and diverge).
    planningCardAsQuantity: full.requestOrigin === 'public',
  });
}

// What a FULL online payment of a public devis charges = exactly what the payment then records: the
// **stored** acompte plus the **stored** solde, i.e. the pre-arrival amount the guest agreed to on the
// quote — tourist tax included unless it is paid on arrival, and any line routed to the arrival
// complement excluded (specs/deposit-blocks-the-dates.md rule 18, decided 2026-10-27). It used to be
// `finalPrice + touristTaxTotal`, which also charged the complement lines the stay then asks for again
// on arrival.
//
// IMPORTANT: the amount must come from the SAVED devis, NOT a fresh engine recompute — a recompute can
// drift from the quote (e.g. the engine auto-adds a "Linge de lit" auto-option the public quote never
// showed), which would over-charge the guest. Falls back to the passed row on any failure.
function savedDevis({ devisModel }, devisId, fallbackRow) {
  return (devisModel && typeof devisModel.findById === 'function' && devisModel.findById(devisId)) || fallbackRow || {};
}

function preArrivalCents(devis) {
  return Math.round((Number(devis.depositAmount || 0) + Number(devis.balanceAmount || 0)) * 100);
}

function fullPaymentCents({ devisModel }, devisId, fallbackRow) {
  return preArrivalCents(savedDevis({ devisModel }, devisId, fallbackRow));
}

// Global VAT rate (single-rate model, specs/single-vat-rate.md). Falls back to 10 on any read failure.
function globalVatRate(database) {
  try {
    const row = database.prepare('SELECT vatRate FROM app_settings WHERE id = 1').get();
    return row && row.vatRate != null ? Number(row.vatRate) : 10;
  } catch { return 10; }
}

// VAT basket components for a public FULL payment (specs/payment-links-vat.md): the stay part of the
// pre-arrival amount (VAT-liable at the global rate) as one taxable line, plus the tourist tax as a
// 0 %-VAT line (VAT-exempt) — unless it is paid on arrival (collected there, or forced to the
// complement), then no tax line. The engine is re-run ONLY to read the `collectedOnArrival` flag (a
// property-config boolean, never an amount). Sum of components === fullPaymentCents by construction.
function fullPaymentComponents({ database, devisModel, calc }, devisId, fallbackRow) {
  const devis = savedDevis({ devisModel }, devisId, fallbackRow);
  const totalCents = preArrivalCents(devis);

  let collectedOnArrival = Number(devis.touristTaxInComplement || 0) === 1;
  if (!collectedOnArrival) {
    try {
      const q = recomputeDevisQuote({ database, devisModel, calc }, devisId);
      if (q) collectedOnArrival = Boolean(q.touristTaxCollectedOnArrival);
    } catch { /* default: tax included */ }
  }

  const taxCents = collectedOnArrival ? 0 : Math.round(Number(devis.touristTaxTotal || 0) * 100);
  if (taxCents > totalCents) return null;
  const components = [{ title: 'Séjour et prestations', grossCents: totalCents - taxCents, taxable: true }];
  if (taxCents > 0) components.push({ title: 'Taxe de séjour', grossCents: taxCents, taxable: false });
  return { components, vatRatePercent: globalVatRate(database) };
}

module.exports = { recomputeDevisQuote, fullPaymentCents, fullPaymentComponents };
