/**
 * Trop-perçu (specs/reservation-refunds.md rule 34): what the guest paid on the acompte and the solde
 * beyond what the stay now costs, net of what was already given back.
 *
 * A paid bucket's collected amount is read from the contribs captured when it was ticked — they add up
 * to that day's amount (specs/force-item-to-complement.md, conservation), so they survive a later save
 * that lowers the bucket. Without a capture (a stay ticked before captures existed), the stored amount
 * is the only knowledge there is. A caisse-interne bucket is money received too.
 *
 * Pure: the caller reads the row, the captured sums and the refunds.
 */

const { isDirectChannel } = require('./platformNameFormat');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * @param {object} row       reservation row (depositPaid/Cash, balancePaid/Cash, depositAmount, balanceAmount)
 * @param {{ deposit: (number|null), balance: (number|null) }} captured  Σ contribs per bucket, null when none
 * @returns {number} the money received on the pre-arrival schedule
 */
function collectedOnSchedule(row = {}, captured = {}) {
  const sums = captured || {};
  const bucket = (paid, cash, capturedSum, stored) => {
    if (!(Number(paid || 0) === 1 || Number(cash || 0) === 1)) return 0;
    return capturedSum == null ? Number(stored || 0) : Number(capturedSum);
  };
  return round2(
    bucket(row.depositPaid, row.depositPaidCash, sums.deposit, row.depositAmount)
    + bucket(row.balancePaid, row.balancePaidCash, sums.balance, row.balanceAmount),
  );
}

/**
 * @param {object} args
 * @param {object} args.row            the reservation as stored (its payment flags and amounts)
 * @param {object} args.captured       Σ contribs per bucket (see collectedOnSchedule)
 * @param {number} args.refundedTtc    every refund already given back, whatever the means
 * @param {number} [args.depositAmount] the schedule the stay now has (default: the stored one)
 * @param {number} [args.balanceAmount]
 * @param {number} [args.engineOverTtc] the engine's `overCollectedTtc`: what a paid acompte and solde
 *   hold beyond what they now cover, when the engine kept their amounts frozen
 * @returns {number} ≥ 0 — the trop-perçu, 0 when the stay is not over-collected
 */
function overpaymentOf({ row = {}, captured = {}, refundedTtc = 0, depositAmount, balanceAmount, engineOverTtc = 0 }) {
  // Rule 38 — the guest of a platform stay paid the platform, which refunds them itself: GuestFlow has no
  // trop-perçu to give back there.
  if (!isDirectChannel(row.platform)) return 0;
  const pick = (given, stored) => Number((given === undefined ? stored : given) || 0);
  const due = pick(depositAmount, row.depositAmount) + pick(balanceAmount, row.balanceAmount);
  // A paid bucket lowered by the save (captured above the new amount), or kept frozen by the engine
  // above what the smaller stay now owes: the two ways a reduction leaves money received in excess.
  const excess = Math.max(collectedOnSchedule(row, captured) - due, Number(engineOverTtc) || 0);
  return Math.max(0, round2(excess - Number(refundedTtc || 0)));
}

// The postes a refund line is booked on (specs/reservation-refunds.md §3.5), in display order.
const POSTES = [
  { bucket: 'accommodation', label: 'Hébergement' },
  { bucket: 'options', label: 'Prestations complémentaires' },
  { bucket: 'resources', label: 'Activités' },
  { bucket: 'touristTax', label: 'Taxe de séjour' },
];

// What the stay now costs on each poste, from the engine's quote. The accommodation is what is left
// of the sale once the options and the activities are taken out, so a discount lands on it.
function currentByPoste(quote = {}) {
  const options = round2(quote.optionsTotal);
  const resources = round2(quote.resourcesTotal);
  return {
    accommodation: round2(Number(quote.finalPrice || 0) - options - resources),
    options,
    resources,
    touristTax: round2(quote.touristTaxTotal),
  };
}

/**
 * The trop-perçu split by poste (specs/reservation-refunds.md rule 35): a refund that gives back tourist
 * tax must be booked on the tax, not on the accommodation, or the books lower the turnover and keep a
 * tax nobody owes any more.
 *
 * Each poste's excess is what its paid buckets captured beyond what the stay now costs on it. The
 * trop-perçu itself stays the authority on the total: it is spread over the postes in proportion to
 * their excess, the cents left by rounding going to the largest. Without a capture to read (a stay
 * ticked before captures existed, or no poste in excess) the whole amount stays on the accommodation,
 * the operator's only option before this rule.
 *
 * @param {object} args
 * @param {object} args.row        reservation row (its paid flags)
 * @param {{ deposit: (object|null), balance: (object|null) }} args.capturedByPoste
 *   per paid bucket, the contribs it captured on each poste ({ accommodation, options, resources, touristTax })
 * @param {object} args.quote      the engine's quote of the stay as it now stands
 * @param {number} args.overpaymentTtc the trop-perçu (overpaymentOf)
 * @returns {Array<{ bucket, label, amountTtc, collectedTtc, dueTtc }>} one line per poste in excess
 */
function overpaymentLinesOf({ row = {}, capturedByPoste = {}, quote = {}, overpaymentTtc = 0 }) {
  const total = round2(overpaymentTtc);
  if (!(total > 0)) return [];
  const paid = (flag, cash) => Number(flag || 0) === 1 || Number(cash || 0) === 1;
  const sources = [
    paid(row.depositPaid, row.depositPaidCash) ? (capturedByPoste || {}).deposit : null,
    paid(row.balancePaid, row.balancePaidCash) ? (capturedByPoste || {}).balance : null,
  ].filter(Boolean);
  const due = currentByPoste(quote);
  const lines = POSTES.map(({ bucket, label }) => {
    const collectedTtc = round2(sources.reduce((sum, s) => sum + Number(s[bucket] || 0), 0));
    return { bucket, label, collectedTtc, dueTtc: due[bucket], excess: Math.max(0, round2(collectedTtc - due[bucket])) };
  });
  const excessTotal = round2(lines.reduce((sum, l) => sum + l.excess, 0));
  if (!(excessTotal > 0)) {
    const accommodation = lines[0];
    return [{ bucket: 'accommodation', label: accommodation.label, amountTtc: total, collectedTtc: accommodation.collectedTtc, dueTtc: accommodation.dueTtc }];
  }
  const inExcess = lines.filter((l) => l.excess > 0);
  const shares = inExcess.map((l) => ({ ...l, amountTtc: round2((total * l.excess) / excessTotal) }));
  const drift = round2(total - shares.reduce((sum, l) => sum + l.amountTtc, 0));
  if (drift !== 0) {
    const largest = shares.reduce((a, b) => (b.excess > a.excess ? b : a));
    largest.amountTtc = round2(largest.amountTtc + drift);
  }
  return shares
    .filter((l) => l.amountTtc > 0)
    .map(({ bucket, label, amountTtc, collectedTtc, dueTtc }) => ({ bucket, label, amountTtc, collectedTtc, dueTtc }));
}

module.exports = { collectedOnSchedule, overpaymentOf, overpaymentLinesOf, currentByPoste };
