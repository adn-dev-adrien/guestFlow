/**
 * The « Paiement plateforme » block of an Airbnb booking (specs/airbnb-mail-intake.md rules 9–10).
 * Pure. Reading A, decided 2026-10-24: the « Taxe de séjour retenue » is the part of the guest's taxes
 * Airbnb keeps — the rest is handed to the host — and the commission is then Airbnb's host fee exactly.
 */

const toCents = (n) => Math.round(Number(n) * 100);

function paymentBlock(booking, { withholds }) {
  const gross = toCents(booking.total);
  const payout = toCents(booking.payout);
  const kept = toCents(booking.guestTaxes) - toCents(booking.hostTaxes);
  if (kept < 0) return { ok: false, error: 'Airbnb reverse plus de taxes que le voyageur n’en a payé' };
  // Rule 10 — outside the `platform` tax mode the box stays empty, as on a Booking fiche.
  if (!withholds) {
    return { ok: true, block: { platformGrossAmount: gross / 100, platformTouristTaxAmount: null, platformPayoutAmount: payout / 100 }, taxLeftEmpty: true };
  }
  if (gross - payout - kept !== toCents(booking.hostFee)) {
    return { ok: false, error: 'La commission ne retombe pas sur les frais de service Airbnb' };
  }
  return { ok: true, block: { platformGrossAmount: gross / 100, platformTouristTaxAmount: kept / 100, platformPayoutAmount: payout / 100 }, taxLeftEmpty: false };
}

module.exports = { paymentBlock };
