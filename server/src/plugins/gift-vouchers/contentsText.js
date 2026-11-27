/**
 * What a voucher contains, written the way the buyer reads it (specs/gift-vouchers/gift-voucher-campaigns.md rules 20, 21): read from the contents frozen on the voucher, never from the
 * catalogue, so a resource renamed later changes nothing on a printed card. The same lines head the PDF's back and the mail.
 */

const rules = require('./voucherRules');
const { durationText } = require('./offerService');

// A non-breaking space before the colon: it never starts a line on the PDF's back or on the site's.
const NBSP_COLON = '\u00a0:';

const BAND_WORDS = Object.freeze({ day: 'en journée', evening: 'en soirée' });

/** Rule 66 — the one line of a lodging voucher, with its amount left to fill: the site writes the amount the buyer types in `{amount}`. */
const LODGING_LINE = 'Un séjour dans nos logements, d’une valeur de {amount}';

/** « Temps supplémentaire : 1 h » — one line of the back, the same on the PDF, the mail and the site. */
const extraTimeLine = (minutes) => `Temps supplémentaire${NBSP_COLON} ${durationText(minutes)}`;

const countOf = (qty, label) => (qty > 1 ? `${qty} × ${label}` : label);

/** → the lines under « Votre bon comprend » : a lodging voucher says only its value, a composed one its session, its options and the extra time. */
function contentLines(voucher) {
  const contents = rules.contentsOf(voucher);
  if (contents.kind === 'lodging') return [LODGING_LINE.replace('{amount}', rules.formatEuros(voucher.amountCents))];
  const { resource } = contents;
  return [
    `${resource.name}${NBSP_COLON} ${durationText(resource.includedMinutes)} ${BAND_WORDS[resource.band] || ''}`.trim() + rules.periodSuffix(resource),
    ...contents.options.map((o) => countOf(o.qty, o.label)),
    ...(resource.extraMinutes > 0 ? [extraTimeLine(resource.extraMinutes)] : []),
    ...contents.addOns.map((o) => countOf(o.qty, o.label)),
  ];
}

module.exports = {
  contentLines, LODGING_LINE, extraTimeLine, countOf,
};
