/**
 * What the « Paiement plateforme » block says about the statement typed on a fiche, worded here so the client only
 * renders it (specs/platform-host-statement-and-commission-vat.md rules 7, 10, 11, 12). Pure.
 *
 * Returns `{ lines: [{ tone, label }], warnings: { commissionRate }, refusals: { [field]: message }, optionAdjustment }`:
 * `tone` is `done` (the figures close), `warning` (they do not, the stay is saved anyway), `info`.
 */
const { roundMoneyStrict: round2 } = require('./pricing/money');
const { taxPaidWithPayout } = require('./pricing/platformPayment');
const { formatEuros } = require('./reservationLedger');

const NBSP = ' ';
const blank = (value) => value === '' || value == null || !Number.isFinite(Number(value));
const money = (value) => (blank(value) ? 0 : Math.max(0, Number(value)));
const signed = (value) => `${value < 0 ? '−' : '+'}${formatEuros(Math.abs(value))}`;
const percent = (value) => `${String(Number(value.toFixed(1))).replace('.', ',')}${NBSP}%`;

/**
 * @param {object} p
 * @param {object} p.figures        the statement as typed: platformGrossAmount, platformOptionsAmount, platformTouristTaxAmount,
 *                                  platformPayoutAmount, platformCommissionAmount, acompteCommissionAmount
 * @param {string} p.mode           the platform's tourist-tax mode: 'platform' | 'platform_reversed' | 'owner'
 * @param {number} p.touristTaxGap  what the platform paid for the tax beyond GuestFlow's own (signed), from `touristTaxGapOf(quote)`
 * @param {string} p.platformLabel  « Airbnb »
 * @param {number} p.commissionPercent  the platform's rate, 0 when unknown
 * @param {string[]} [p.adjustmentNotes]  the sentences of rule 2
 * @param {{ field: string, message: string } | null} [p.adjustmentRefusal]  rule 2's one refusal
 * @param {boolean} [p.boxBooked]  false when the stay's tax was frozen at 0 under another mode: the box is not booked, so it is not counted
 * @param {string|null} [p.commissionBooking]  how the commission is booked (rule 10), when the accounting knows it
 */
function statementReadout({
  figures, mode, touristTaxGap = 0, boxBooked = true, platformLabel = '', commissionPercent = 0, adjustmentNotes = [], adjustmentRefusal = null, commissionBooking = null,
}) {
  const lines = [];
  const refusals = {};
  const warnings = { commissionRate: null };
  const host = money(figures.platformGrossAmount);
  // A tax frozen before the platform switched to « nous reverse » books nothing: its box is not counted, and the block says so.
  const taxPaid = boxBooked ? taxPaidWithPayout({ mode, box: figures.platformTouristTaxAmount }) : 0;
  const boxIgnored = !boxBooked && mode === 'platform_reversed' && !blank(figures.platformTouristTaxAmount);
  const commission = round2(money(figures.platformCommissionAmount) + money(figures.acompteCommissionAmount));

  if (adjustmentRefusal) refusals[adjustmentRefusal.field] = adjustmentRefusal.message;
  for (const note of adjustmentNotes) lines.push({ tone: 'info', label: note });

  if (!blank(figures.platformGrossAmount) && commission > round2(host + taxPaid) + 0.005) {
    refusals.platformCommissionAmount = 'La commission ne peut pas dépasser le montant hôte et la taxe de séjour versée avec le virement.';
  }

  if (!blank(figures.platformGrossAmount) && !blank(figures.platformPayoutAmount)) {
    const payout = Number(figures.platformPayoutAmount);
    const expected = round2(host + taxPaid - commission);
    const taxPart = taxPaid > 0 ? ` + taxe ${formatEuros(taxPaid)}` : '';
    const equation = `Montant hôte ${formatEuros(host)}${taxPart} − commission ${formatEuros(commission)} = ${formatEuros(expected)}`;
    const gap = round2(expected - payout);
    lines.push(Math.abs(gap) < 0.005
      ? { tone: 'done', label: `${equation} — identique au virement ✓` }
      : { tone: 'warning', label: `${equation} — le virement est de ${formatEuros(payout)} (écart ${formatEuros(Math.abs(gap))}). Le relevé sera enregistré avec cet écart.` });
  }

  if (boxIgnored) lines.push({ tone: 'info', label: 'Taxe figée avant le passage en « nous reverse » : non comptée.' });

  const gap = Number(touristTaxGap || 0);
  if (mode === 'platform_reversed' && !blank(figures.platformTouristTaxAmount) && Math.abs(gap) >= 0.005) {
    const box = round2(Number(figures.platformTouristTaxAmount));
    lines.push({
      tone: 'info',
      label: `Écart de taxe de séjour : ${signed(gap)} (${platformLabel} ${formatEuros(box)}, GuestFlow ${formatEuros(round2(box - gap))}) ${gap > 0 ? 'ajouté au' : 'retiré du'} logement.`,
    });
  }

  if (commissionBooking) lines.push({ tone: 'info', label: commissionBooking });

  const rate = Number(commissionPercent);
  if (rate > 0 && host > 0 && commission > 0) {
    const actual = (commission / host) * 100;
    if (Math.abs(actual - rate) > 1) {
      warnings.commissionRate = `Commission à ${percent(actual)} du montant hôte, ${platformLabel} est à ${percent(rate)} : le montant hôte contient-il les frais payés par le voyageur ?`;
    }
  }

  return { lines, warnings, refusals };
}

module.exports = { statementReadout };
