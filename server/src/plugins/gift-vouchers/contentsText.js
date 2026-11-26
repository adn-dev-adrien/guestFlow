/**
 * What a voucher contains, written the way the buyer reads it (specs/gift-voucher-campaigns.md rules 20, 21): read from the contents frozen on the voucher, never from the
 * catalogue, so a resource renamed later changes nothing on a printed card. The same lines head the PDF's back and the mail.
 */

const rules = require('./voucherRules');
const { durationText } = require('./offerService');

const BAND_WORDS = Object.freeze({ day: 'en journée', evening: 'en soirée' });

/** Rule 66 — the one line of a lodging voucher, with its amount left to fill: the site writes the amount the buyer types in `{amount}`. */
const LODGING_LINE = 'Un séjour dans nos logements, d’une valeur de {amount}';

const countOf = (qty, label) => (qty > 1 ? `${qty} × ${label}` : label);

/** → the lines under « Votre bon comprend » : a lodging voucher says only its value, a composed one its session, its options and the extra time. */
function contentLines(voucher) {
  const contents = rules.contentsOf(voucher);
  if (contents.kind === 'lodging') return [LODGING_LINE.replace('{amount}', rules.formatEuros(voucher.amountCents))];
  const { resource } = contents;
  return [
    `${resource.name} : ${durationText(resource.includedMinutes)} ${BAND_WORDS[resource.band] || ''}`.trim(),
    ...contents.options.map((o) => countOf(o.qty, o.label)),
    ...(resource.extraMinutes > 0 ? [`Temps supplémentaire : ${durationText(resource.extraMinutes)}`] : []),
    ...contents.addOns.map((o) => countOf(o.qty, o.label)),
  ];
}

module.exports = { contentLines, LODGING_LINE };
