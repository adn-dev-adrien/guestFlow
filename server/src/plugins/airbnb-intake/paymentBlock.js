/**
 * The « Paiement plateforme » block of an Airbnb booking (specs/platforms/airbnb-mail-intake.md rules 9–10, as amended by
 * specs/platforms/platform-host-statement-and-commission-vat.md rules 1, 5 and 20). Pure.
 *
 * The block is the HOST side of the « Vous gagnez » statement: « Location » = room fees with their adjustments, « Options » = the
 * cleaning fee; their sum is the brut. The box reads the platform's tax mode: the taxes handed to the host in `platform_reversed`, the
 * part Airbnb kept in `platform`, nothing in `owner`. The commission is then Airbnb's host fee exactly, which the core's formula proves.
 */

const sdk = require('../sdk');
const { toCentsStrict: toCents } = sdk.coreModule('money');

// `platformCommission` is the core's PLATFORM PAYMENT (SDK `reservations.platformCommission`): the commission is never worked out here.
function paymentBlock(booking, { mode, platform, platformCommission }) {
  const host = toCents(booking.roomFees) + toCents(booking.adjustments) + toCents(booking.cleaningFee);
  const options = toCents(booking.cleaningFee);
  const payout = toCents(booking.payout);
  const kept = toCents(booking.guestTaxes) - toCents(booking.hostTaxes);
  if (kept < 0) return { ok: false, error: 'Airbnb reverse plus de taxes que le voyageur n’en a payé' };
  let box = null;
  if (mode === 'platform_reversed') box = toCents(booking.hostTaxes);
  else if (mode === 'platform') box = kept;
  // Airbnb's own arithmetic holds in every mode — payout = host amount + taxes handed to the host − host fee — so the check folds the taxes
  // into the gross where the platform's mode does not add the box itself (a platform not yet switched to `platform_reversed`: its fiche then
  // shows the gap between its commission and its transfer, which is what asks for the switch).
  const reverses = mode === 'platform_reversed';
  const commission = platformCommission({
    platform,
    gross: (reverses ? host : host + toCents(booking.hostTaxes)) / 100,
    payout: payout / 100,
    touristTax: box == null ? 0 : box / 100,
  });
  if (commission == null || toCents(commission) !== toCents(booking.hostFee)) {
    return { ok: false, error: 'La commission ne retombe pas sur les frais de service Airbnb' };
  }
  return {
    ok: true,
    block: {
      platformGrossAmount: host / 100,
      platformOptionsAmount: options / 100,
      platformTouristTaxAmount: box == null ? null : box / 100,
      platformPayoutAmount: payout / 100,
    },
    commission,
    taxLeftEmpty: box == null,
  };
}

module.exports = { paymentBlock };
