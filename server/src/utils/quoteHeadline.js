/**
 * The headline figure of a quote — what the fiche's sticky total bar prints below 1200 px
 * (specs/ui-review-2026-10-19-operations.md rules 10-11, decision 6 of the UI/UX review).
 *
 * A platform stay leads with what the operator banks (« Vous percevez » = `sejourNetTotal`), with what
 * the guest pays as its second figure. A direct stay leads with « Total du séjour » and names « Total
 * perçu » as soon as the two differ by a cent, whatever the reason.
 *
 * « Total du séjour » is the same gross as the first line of the pricing summary's cascade: the stay
 * price, the tourist tax as the books know it — the amount the platform withheld when the operator
 * stated it, else the tax the stay carries (0 when the platform handles it) — and the part of the
 * end-of-stay complement billed by the departure SAS — the mid-stay part is already inside `finalPrice`.
 * specs/ui-review-2026-10-19-operations.md rule 31: one definition for the live quote and the stored
 * row. The engine's own estimate of a tax the platform handles is not a stored fact, and reading it
 * here made the same fiche print 506 live and 500 stored.
 *
 * Pure: takes the quote `calculateReservationQuote` is about to return, or the stored row's figures.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function stayGross(q = {}) {
  const tax = q.platformTouristTaxWithheld != null
    ? Number(q.platformTouristTaxWithheld)
    : Number(q.touristTaxTotal ?? 0);
  const midStay = Number(q.midStayRemainingTotal ?? q.midStayExtrasTotal ?? 0);
  const endOfStaySas = Math.max(0, Number(q.endOfStayComplementTotal || 0) - midStay);
  return round2(Number(q.finalPrice || 0) + tax + endOfStaySas);
}

/**
 * @param {object} quote      the pricing quote
 * @param {{ isPlatform: boolean }} opts  whether the stay was sold by a platform (not a direct channel)
 * @returns {{ label: string, amount: number, secondary: { label: string, amount: number } | null }}
 */
function quoteHeadline(quote = {}, { isPlatform = false } = {}) {
  const gross = stayGross(quote);
  const net = round2(quote.sejourNetTotal ?? gross);
  if (isPlatform) {
    return { label: 'Vous percevez', amount: net, secondary: { label: 'Total du séjour', amount: gross } };
  }
  // Whatever makes the two differ — a refund, a reduction, a tip, a commission on a channel that counts
  // as direct (Lodgify on Solio), money collected above the stay — the operator sees what is banked.
  return {
    label: 'Total du séjour',
    amount: gross,
    secondary: Math.abs(net - gross) > 0.005 ? { label: 'Total perçu', amount: net } : null,
  };
}

/**
 * « Total perçu » of a STORED row, on the engine's definition (`sejourNetTotal`, rule 31): every
 * bucket the stay carries — collected or not, caisse interne included — net of the platform
 * commissions, plus the mid-stay notes, minus the book refunds, plus the arrival payment adjustment.
 * The finance pages keep their own caisse-interne carve-out (fiche-total-sejour-net-of-commission.md
 * rule 10); the fiche's headline does not, live or stored.
 */
function storedNetTotal(row = {}, { refundsBookTtc = 0 } = {}) {
  const { midStayNotesTotal, arrivalPaymentAdjustment } = require('./reservationSettlement');
  const deposit = Number(row.depositDisabled || 0) === 1 ? 0 : Number(row.depositAmount || 0);
  return round2(
    deposit + Number(row.balanceAmount || 0)
    + storedPlanCarries(row)
    - Number(row.acompteCommissionAmount || 0) - Number(row.platformCommissionAmount || 0)
    + Number(row.complementAmount || 0) + Number(row.endOfStayComplementAmount || 0)
    + midStayNotesTotal(row, { withCash: true })
    - Number(refundsBookTtc || 0)
    + arrivalPaymentAdjustment(row).net,
  );
}

/**
 * What an installment plan contributes to « Total perçu » (specs/reservation-payment-ledger.md rule 48),
 * the stored twin of the engine's `planCarries`: every installment once all are paid; otherwise the stay's
 * pre-arrival amount (`installmentsTarget`), or what was collected when that is more. A plan left above
 * the stay by a drop (direct-installments rule 8) shows its gap on the ledger, never in this total.
 */
function storedPlanCarries(row = {}) {
  const paid = Number(row.installmentsPaidAmount || 0);
  const unpaid = Number(row.installmentsUnpaidAmount || 0);
  const target = Number(row.installmentsTarget || 0);
  if (!(unpaid > 0)) return paid;
  return target > 0 ? Math.max(target, paid) : paid + unpaid;
}

/**
 * The pricing summary's closing cascade, shaped by the server so the panel only prints it
 * (specs/ui-review-2026-10-19-operations.md rule 32): « Total du séjour » (the headline's gross), the
 * tourist tax the platform kept out of it, what is collected on site, and the amount the platform
 * commissions on.
 */
function summaryCascade(q = {}) {
  const offeredTaxDeduction = q.touristTaxOfferedByPlatform && q.platformTouristTaxWithheld != null
    ? round2(q.platformTouristTaxWithheld)
    : 0;
  const onSiteTotal = round2(Number(q.complementAmount || 0) + Number(q.endOfStayComplementTotal || 0)
    + Number(q.midStaySettledTotal || 0));
  return {
    grossTotal: stayGross(q),
    offeredTaxDeduction,
    onSiteTotal,
    commissionBase: round2(q.preArrivalAmount),
  };
}

module.exports = { quoteHeadline, stayGross, storedNetTotal, summaryCascade };
