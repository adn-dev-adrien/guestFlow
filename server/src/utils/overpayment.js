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
 * The excess the ENGINE finds on a priced stay, before refunds and never clamped by them: what the paid
 * buckets hold beyond what the stay now owes, or what the engine kept frozen above it. The unit the live
 * ledger compares a posted fiche and the stored stay in (a delta must not mix refund bases).
 */
function engineExcessOf({ row = {}, captured = {}, depositAmount, balanceAmount, engineOverTtc = 0 }) {
  if (!isDirectChannel(row.platform)) return 0;
  const pick = (given, stored) => Number((given === undefined ? stored : given) || 0);
  const due = pick(depositAmount, row.depositAmount) + pick(balanceAmount, row.balanceAmount);
  return round2(Math.max(collectedOnSchedule(row, captured) - due, Number(engineOverTtc) || 0));
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

/**
 * The trop-perçu of a stay read from what is STORED (reservation-save-keeps-pricing.md rule 8): what was
 * collected beyond the stored stay total (`finalPrice` + tourist tax), net of the free « Trop-perçu » refunds.
 * Today's engine is never consulted for the amount, so a drift between the engine and the price the stay
 * was sold at is not a trop-perçu, and one the operator confirmed (a reduction after the solde was paid)
 * is still there after the reload.
 *
 * Collected = each paid bucket at the larger of what its contribs captured and its stored amount (removing a
 * paid line drops its contrib; the guest still paid it), the paid installments, the paid arrival complement
 * and what the mid-stay extras collected (they are inside `finalPrice`). A complement the operator adjusted is
 * left out of BOTH sides: the engine's automatic one is what the total carries. Only free refund lines reduce
 * the excess; the refund of a sold line takes its price off both sides.
 *
 * @param {object} args row (stored), captured (Σ contribs per bucket), freeRefundedTtc, installmentsPaidTtc,
 *   midStayCollectedTtc, autoComplementTtc (the engine's complement without the adjustment)
 * @returns {number} ≥ 0
 */
function storedOverpaymentOf({
  row = {}, captured = {}, freeRefundedTtc = 0, installmentsPaidTtc = 0, midStayCollectedTtc = 0, autoComplementTtc = 0,
}) {
  if (!isDirectChannel(row.platform)) return 0;
  const sums = captured || {};
  const bucket = (paid, cash, capturedSum, stored) => (
    Number(paid || 0) === 1 || Number(cash || 0) === 1 ? Math.max(Number(capturedSum || 0), Number(stored || 0)) : 0
  );
  const schedule = bucket(row.depositPaid, row.depositPaidCash, sums.deposit, row.depositAmount)
    + bucket(row.balancePaid, row.balancePaidCash, sums.balance, row.balanceAmount);
  const adjusted = row.complementAmountOverride != null && row.complementAmountOverride !== '';
  const complementPaid = Number(row.complementPaid || 0) === 1 || Number(row.complementPaidCash || 0) === 1;
  const complement = complementPaid && !adjusted ? Number(row.complementAmount || 0) : 0;
  const collected = schedule + Number(installmentsPaidTtc || 0) + complement + Number(midStayCollectedTtc || 0);
  const owed = Number(row.finalPrice || 0) + Number(row.touristTaxTotal || 0) - (adjusted && complementPaid ? Number(autoComplementTtc || 0) : 0);
  return Math.max(0, round2(collected - owed - Number(freeRefundedTtc || 0)));
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
 * @param {{touristTax?: number, options?: number, resources?: number}} [args.complementLeft] what the stored
 *   complement carried on each poste beyond what the stay's complement now carries
 * @returns {Array<{ bucket, label, amountTtc, collectedTtc, dueTtc }>} one line per poste in excess
 */
function overpaymentLinesOf({ row = {}, capturedByPoste = {}, quote = {}, overpaymentTtc = 0, complementLeft = {}, leftover = {} }) {
  const total = round2(overpaymentTtc);
  if (!(total > 0)) return [];
  // What a collected complement holds above the stay (reservation-save-keeps-pricing.md rule 4) has no
  // captured split. A complement carries options, resources and the tax, never the accommodation: the
  // excess is what an option or a resource moved out of it (the bed linen), so it is booked on the
  // prestations the stay still sells — options first.
  const complementExcess = Math.min(total, round2(quote.complementCollectedExcessTtc));
  if (complementExcess > 0) {
    const rest = round2(total - complementExcess);
    const lines = rest > 0 ? scheduleLines({ row, capturedByPoste, quote, total: rest, leftover }) : [];
    let remaining = complementExcess;
    // The history window of the complement overlaps the schedule's: what the schedule share already took
    // from a poste is not taken again from the complement's.
    const taken = (poste) => round2(lines.filter((l) => l.bucket === poste.bucket && l.excessOnly).reduce((t, l) => t + l.amountTtc, 0));
    const add = (poste, amount, alreadyTaken = 0) => {
      const part = Math.min(remaining, Math.max(0, round2(amount - alreadyTaken)));
      if (!(part > 0)) return;
      const existing = lines.find((l) => l.bucket === poste.bucket);
      if (existing) existing.amountTtc = round2(existing.amountTtc + part);
      else lines.push({ ...poste, amountTtc: part, collectedTtc: part, dueTtc: 0, excessOnly: true });
      remaining = round2(remaining - part);
    };
    // What the edit took out of the complement, poste by poste (the tourist tax included), when the stored
    // lines say so; the unexplained rest falls on the prestations the stay still sells.
    add(POSTES[3], complementLeft.touristTax);
    add(POSTES[1], complementLeft.options, taken(POSTES[1]));
    add(POSTES[2], complementLeft.resources, taken(POSTES[2]));
    add(complementExcessPoste(quote), remaining);
    return lines;
  }
  return scheduleLines({ row, capturedByPoste, quote, total, leftover });
}

function complementExcessPoste(quote) {
  if (round2(quote.optionsTotal) > 0) return { bucket: 'options', label: POSTES[1].label };
  if (round2(quote.resourcesTotal) > 0) return { bucket: 'resources', label: POSTES[2].label };
  return { bucket: 'accommodation', label: POSTES[0].label };
}

function scheduleLines({ row, capturedByPoste, quote, total, leftover = {} }) {
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
    // No captured split to read: the excess is what LEFT the stay since it was collected — the tourist tax
    // first, then the options, the resources — and what nothing explains falls on the accommodation. Each line
    // says what it is: an amount collected in excess.
    let remaining = total;
    const split = [];
    for (const [bucket, hint] of [['touristTax', leftover.touristTax], ['options', leftover.options], ['resources', leftover.resources]]) {
      const part = Math.min(remaining, round2(hint));
      if (!(part > 0)) continue;
      split.push({ bucket, label: POSTES.find((p) => p.bucket === bucket).label, amountTtc: part, collectedTtc: part, dueTtc: 0, excessOnly: true });
      remaining = round2(remaining - part);
    }
    if (remaining > 0) split.push({ bucket: 'accommodation', label: POSTES[0].label, amountTtc: remaining, collectedTtc: remaining, dueTtc: 0, excessOnly: true });
    return split;
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

module.exports = { collectedOnSchedule, overpaymentOf, engineExcessOf, storedOverpaymentOf, overpaymentLinesOf, currentByPoste };
