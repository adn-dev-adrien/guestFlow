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

// Cents to charge for a FULL online payment of a public devis: the tax-INCLUSIVE total
// (`totalStayPrice` = accommodation + options + resources + tourist tax), EXCEPT when the tax is
// collected on arrival → then `finalPrice` (tax-exclusive). Falls back to the stored finalPrice column
// on any engine failure so a payment is never blocked by a recompute hiccup.
function fullPaymentCents({ database, devisModel, calc }, devisId, fallbackRow) {
  try {
    const q = recomputeDevisQuote({ database, devisModel, calc }, devisId);
    if (q) {
      const euros = q.touristTaxCollectedOnArrival
        ? Number(q.finalPrice || 0)
        : Number(q.totalStayPrice || 0);
      if (euros > 0) return Math.round(euros * 100);
    }
  } catch { /* fall back to the stored column */ }
  return Math.round(Number((fallbackRow && fallbackRow.finalPrice) || 0) * 100);
}

module.exports = { recomputeDevisQuote, fullPaymentCents };
