/**
 * The headline figure of a quote — what the fiche's sticky total bar prints below 1200 px
 * (specs/ui-review-2026-10-19-operations.md rules 10-11, decision 6 of the UI/UX review).
 *
 * A platform stay leads with what the operator banks (« Vous percevez » = `sejourNetTotal`), with what
 * the guest pays as its second figure. A direct stay leads with « Total du séjour » and names « Total
 * perçu » as soon as the two differ by a cent, whatever the reason.
 *
 * « Total du séjour » is the same gross as the first line of the pricing summary's cascade: the stay
 * price, the real tourist tax (the amount the platform withheld when the operator stated it) and the
 * part of the end-of-stay complement billed by the departure SAS — the mid-stay part is already
 * inside `finalPrice`.
 *
 * Pure: takes the quote `calculateReservationQuote` is about to return.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function stayGross(q = {}) {
  const tax = q.platformTouristTaxWithheld != null
    ? Number(q.platformTouristTaxWithheld)
    : Number(q.touristTaxOriginalTotal ?? q.touristTaxTotal ?? 0);
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

module.exports = { quoteHeadline, stayGross };
