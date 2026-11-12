/**
 * Trop-perçu — the money a guest paid beyond what the stay costs, net of what was given back for it
 * (specs/reservation-refunds.md rule 34; specs/pricing-components.md §3 rules 72, 74 and 76).
 *
 * ONE formula for every stay: Σ payment allocations − the stay's line totals − the free lines of origin `overpayment`
 * already refunded (owner O-6, O-7 b). A legacy stay reads allocations backfilled from what it stored; a paid bucket lowered
 * after it was paid holds the contribs it captured, so the excess survives the save that lowered it. The refund of a sold line
 * takes its price off both sides, so only a free line of origin `overpayment` is subtracted — a gesture never lowers it.
 * A platform stay has none (reservation-refunds rule 38): the guest paid the platform, which refunds them itself.
 *
 * Pure: the caller (`models/refundInputModel.js`) reads the allocations, the stored total and the refunds, in cents.
 */

const { isDirectChannel } = require('../../platformNameFormat');

const { roundMoneyOrZero: round2 } = require('../money');

// specs/mixed-method-payments.md rule 47 (audit R34-M-H1) — a bucket paid with several methods counts what it RECEIVED.
const receivedOf = (received, bucket) => (received && received[bucket] != null ? Number(received[bucket]) : null);

/**
 * @param {object} ctx
 * @param {string} ctx.platform             the stay's channel (a platform stay holds no trop-perçu)
 * @param {number} ctx.paymentsCents        Σ of the stay's payment allocations
 * @param {number} ctx.adjustedComplementCents  the paid complement the operator adjusted: left out of BOTH sides, the engine's
 *   automatic one being what the total carries (adjustable-complement-amounts)
 * @param {number} ctx.autoComplementCents  the engine's complement without the adjustment, taken off the total when adjusted
 * @param {number} [ctx.departureOwnCents]  what the end-of-stay complement collected for the departure's own sales: no line of the
 *   stay carries them yet, so they are no part of what the stay's total was paid with
 * @param {number} ctx.totalCents           the stay's line totals (`finalPrice` + tourist tax as stored)
 * @param {number} ctx.overpaymentRefundedCents  the free lines of origin `overpayment` already given back
 * @param {number} [ctx.engineDriftCents]   what the engine now prices the stored stay at, minus what the posted fiche would cost
 *   (`asSaved` only): the part of the excess this edit adds on top of the stored one (reservation-save-keeps-pricing rule 9)
 * @param {{ basis: ('stored'|'asSaved') }} [options]
 * @returns {{ cents: number, unclampedCents: number }} the trop-perçu (≥ 0) and the figure before the floor
 */
function overpayment(ctx, { basis = 'stored' } = {}) {
  if (!isDirectChannel(ctx.platform)) return { cents: 0, unclampedCents: 0 };
  const collected = Number(ctx.paymentsCents || 0) - Number(ctx.adjustedComplementCents || 0) - Number(ctx.departureOwnCents || 0);
  // A posted fiche cannot cost less than nothing: the drift lowers the stored total down to zero at most.
  const total = basis === 'asSaved' ? Math.max(0, Number(ctx.totalCents || 0) - Number(ctx.engineDriftCents || 0)) : Number(ctx.totalCents || 0);
  const owed = total - (Number(ctx.adjustedComplementCents || 0) > 0 ? Number(ctx.autoComplementCents || 0) : 0);
  const unclampedCents = collected - owed - Number(ctx.overpaymentRefundedCents || 0);
  return { cents: Math.max(0, unclampedCents), unclampedCents };
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
function overpaymentLinesOf({ row = {}, capturedByPoste = {}, quote = {}, overpaymentTtc = 0, complementLeft = {}, leftover = {}, received = null }) {
  const total = round2(overpaymentTtc);
  if (!(total > 0)) return [];
  // Rule 47 — a bucket paid with several methods collected on each poste its share of what it received.
  const byPoste = receivedByPoste(capturedByPoste, received);
  // What a collected complement holds above the stay (reservation-save-keeps-pricing.md rule 4) has no
  // captured split. A complement carries options, resources and the tax, never the accommodation: the
  // excess is what an option or a resource moved out of it (the bed linen), so it is booked on the
  // prestations the stay still sells — options first.
  const complementExcess = Math.min(total, round2(quote.complementCollectedExcessTtc));
  if (complementExcess > 0) {
    const rest = round2(total - complementExcess);
    const lines = rest > 0 ? scheduleLines({ row, capturedByPoste: byPoste, quote, total: rest, leftover }) : [];
    let remaining = complementExcess;
    // The stored-versus-live comparison of the complement overlaps the lines it named: the hints can add up to more than the
    // complement lost. Only that overflow is taken back, from the postes the schedule share already covers
    // (whatever the way it was split), so a drop that really belongs to the complement is never cut.
    let overflow = Math.max(0, round2(['touristTax', 'options', 'resources'].reduce((t, k) => t + Number(complementLeft[k] || 0), 0) - complementExcess));
    const taken = (poste) => {
      const share = round2(lines.filter((l) => l.bucket === poste.bucket).reduce((t, l) => t + l.amountTtc, 0));
      const cut = Math.min(overflow, share);
      overflow = round2(overflow - cut);
      return cut;
    };
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
  return scheduleLines({ row, capturedByPoste: byPoste, quote, total, leftover });
}

function receivedByPoste(capturedByPoste, received) {
  if (!received || !capturedByPoste) return capturedByPoste;
  const out = { ...capturedByPoste };
  for (const bucket of ['deposit', 'balance']) {
    const captured = out[bucket];
    const got = receivedOf(received, bucket);
    if (!captured || got == null) continue;
    const sum = POSTES.reduce((t, { bucket: poste }) => t + Number(captured[poste] || 0), 0);
    if (!(sum > 0)) continue;
    out[bucket] = Object.fromEntries(POSTES.map(({ bucket: poste }) => [poste, round2((Number(captured[poste] || 0) * Math.min(got, sum)) / sum)]));
  }
  return out;
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

/**
 * What left the stay since its money was collected, per poste, from the LINES and what the payments named on them (rule 74): a line
 * that collected more than it now costs — lowered, offered, removed — has that much in excess on its poste (the options, the
 * resources; the tourist tax on its stay line). No audit log is read: a removed paid line is in the stay's removed-line contribs,
 * a collected complement's lines in its frozen split.
 *
 * @param {Array<{ key: string, poste: 'options'|'resources'|'touristTax', collectedCents: number }>} collected  one entry per line
 *   (several entries on a key add up)
 * @param {Map<string, number>} currentCents  what each key costs now (a missing key costs nothing)
 * @returns {{ options: number, resources: number, touristTax: number }} euros
 */
function postesLeftOf(collected, currentCents) {
  const byKey = new Map();
  for (const entry of collected || []) {
    const held = byKey.get(entry.key) || { poste: entry.poste, collectedCents: 0 };
    held.collectedCents += Number(entry.collectedCents || 0);
    byKey.set(entry.key, held);
  }
  const left = { options: 0, resources: 0, touristTax: 0 };
  for (const [key, { poste, collectedCents }] of byKey) {
    left[poste] += Math.max(0, collectedCents - Number((currentCents && currentCents.get(key)) || 0));
  }
  return Object.fromEntries(Object.entries(left).map(([poste, cents]) => [poste, round2(cents / 100)]));
}

module.exports = { overpayment, overpaymentLinesOf, currentByPoste, postesLeftOf };
