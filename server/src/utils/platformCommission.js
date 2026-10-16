/**
 * The commission of a platform stay, from the figures of its statement
 * (specs/booking-extranet-intake.md §4.1). « Calculer la commission » of the fiche and the Booking
 * intake plugin both ask for it here, so the two can never disagree.
 *
 *   commission = gross − payout − tourist tax withheld − commission already taken on the acompte
 *
 * Rounded to the cent and never negative. Pure.
 */

const round2 = (n) => Math.round(n * 100) / 100;
const asNumber = (v) => (v === '' || v == null ? 0 : Number(v));

function computePlatformCommission({ gross, payout, touristTax = 0, acompteCommission = 0 }) {
  const g = Number(gross);
  const p = Number(payout);
  if (gross === '' || gross == null || payout === '' || payout == null || !Number.isFinite(g) || !Number.isFinite(p)) return null;
  const tax = Math.max(0, asNumber(touristTax) || 0);
  const acompte = asNumber(acompteCommission) || 0;
  return Math.max(0, round2(g - p - tax - acompte));
}

module.exports = { computePlatformCommission };
