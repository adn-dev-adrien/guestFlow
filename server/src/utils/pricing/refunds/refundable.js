/**
 * REFUNDS / refundable — the budget of a stay and the lines a refund can still draw from (rule 72).
 *
 * Three different allocations live here on purpose and are not merged (rule 38, PR C): `capInOrder` caps the lines in the
 * order given (earlier lines first), `spreadBucketRefund` spreads a bucket refund in proportion to what each line can still
 * give (ties: the earlier line). Moved from `utils/refunds.js`. Pure. Keeps its own `round2`.
 */

const { collectedAfterArrival } = require('./collected');
const { ACCOMMODATION_KEY, ACCOMMODATION_LABEL, COMMISSION_KEY, PLAN_BUCKET_LINES, STORED_SPLIT_ROUNDING_TTC, TOURIST_TAX_KEY, TOURIST_TAX_LABEL, billedLineKey, isCommissionLine, isIndemnityLine, isOffBooks, isRequalification, isRetainedDeposit, lineLabelOf, refundedByKey, writtenBeforeAvoir } = require('./register');

const { roundMoneyOrZero: round2 } = require('../money');

/**
 * What a cancelled stay can still give back (specs/reservation-refunds.md rule 48). `collectedTtc` is the book
 * money it collected, net of every book refund (`comptaCollected`). Of the rest, `indemnityLeftTtc` is what the
 * cancellation requalified and no refund has taken from the indemnity yet; `saleLeftTtc` is the remainder — a paid
 * solde, say — which a refund still reverses as revenue + VAT.
 *
 * Rule 48 reading of 2026-11-02 (audit R15-L1) — the caisse interne has a budget of its own: `cashCollectedTtc`
 * (`cashCollected`) less what it gave back, `cashLeftTtc`, refundable in the caisse interne only. A caisse-interne
 * refund beyond that money gave back book money, which comes off `collectedTtc`.
 * Rule 48 reading of 2026-11-02 (review of PR #926, residual A) — the commissions an avoir requalified (lines keyed
 * `commission`) were withheld by the payment provider, never collected: the indemnity never gives them back.
 */
function budget({ collectedTtc, cashCollectedTtc = 0, refunds = [] }) {
  const givenInCash = (refunds || []).filter((r) => isOffBooks(r.method))
    .flatMap((r) => r.lines || []).filter((l) => !isIndemnityLine(l))
    .reduce((sum, l) => sum + Number(l.amountTtc || 0), 0);
  const cash = Math.max(0, round2(cashCollectedTtc));
  const collected = Math.max(0, round2(Number(collectedTtc || 0) - Math.max(0, round2(givenInCash - cash))));
  const requalified = (refunds || []).filter(isRequalification).reduce((sum, r) => sum + Number(r.totalTtc || 0), 0);
  const withheld = (refunds || []).filter(isRequalification).flatMap((r) => r.lines || [])
    .filter((l) => l.lineKey === COMMISSION_KEY).reduce((sum, l) => sum + Number(l.amountTtc || 0), 0);
  const fromIndemnity = (refunds || []).filter((r) => !isRequalification(r))
    .flatMap((r) => r.lines || []).filter(isIndemnityLine)
    .reduce((sum, l) => sum + Number(l.amountTtc || 0), 0);
  const indemnityLeftTtc = Math.min(collected, Math.max(0, round2(requalified - withheld - fromIndemnity)));
  return {
    collectedTtc: collected,
    indemnityLeftTtc,
    saleLeftTtc: round2(collected - indemnityLeftTtc),
    cashCollectedTtc: cash,
    cashLeftTtc: Math.max(0, round2(cash - givenInCash)),
  };
}

/**
 * The lines a reservation can still be refunded on (spec §3.2 rules 7–8).
 *
 * Accommodation is derived the way the accounting model derives it (finalPrice minus the persisted
 * extra lines) so the refundable amounts always match what the journal actually credited. Offered
 * lines are stored at 0 € — there is nothing to give back, so they never appear.
 *
 * @param {object} input
 * @param {number} input.finalPrice     reservation TTC (stay + extras, tax excluded)
 * @param {number} input.touristTaxTotal
 * @param {number} input.vatRate        app-wide sales VAT rate (specs/single-vat-rate.md)
 * @param {Array}  input.options        option + custom-option lines (getByIdWithDetails shape)
 * @param {Array}  input.resources      resource lines
 * @param {Array}  input.refunds        the refund register (header + lines)
 * @param {number} input.nights         nights of the stay — makes the tourist-tax line refundable
 *                                      PER NIGHT (specs/reservation-refunds.md §3.5 rule 27)
 * @param {object} [input.cancelled]    `budget` of a cancelled stay: each line then offers what it
 *                                      collected (rule 48) and carries `indemnityTtc`, the part the indemnity holds
 * @param {object} [input.collected]    `collectedByLine(...)` — on a cancelled stay, each line offers at most what IT
 *                                      collected (rule 49 reading of 2026-11-02)
 * @param {boolean} [input.complementCollected] the arrival complement is paid: its lines did collect their money
 * @param {Array}  [input.goneLines]    `collectedLinesGone(...)` — on a cancelled stay, the lines that collected money
 *                                      and left the fiche since (rule 49 reading of 2026-11-05)
 * @param {object} [input.cashCollected] `collectedByLine({ cash: true })` — the same, for the caisse interne: a line
 *                                      then also offers `cashTtc`, refundable in the caisse interne only (rule 48
 *                                      reading of 2026-11-02, audit R15-L1)
 * @param {object} [input.planBuckets]  on a live stay, `bookedStayBuckets().installments`: what the lines no reading names
 *                                      share (rule 51)
 * @param {object} [input.reservation]  on a live stay, the row, for the money it collected after arrival (rule 51)
 */
function refundable({ finalPrice, touristTaxTotal, vatRate, options = [], resources = [], refunds = [], nights = 0, cancelled = null, collected = null, cashCollected = null, complementCollected = false, goneLines = [], planBuckets = null, reservation = null }) {
  const given = refundedByKey(refunds, (refund) => !isRequalification(refund));
  const fromIndemnity = refundedByKey(refunds, (refund) => !isRequalification(refund), isIndemnityLine);
  const requalified = refundedByKey(refunds, isRequalification, (line) => !isCommissionLine(line));
  // Rule 48 reading of 2026-11-02 (review of PR #926, residual A) — the commissions an avoir requalified, per bucket:
  // they leave their lines like the acompte did, but the indemnity never gives them back.
  const withheld = {};
  for (const line of (refunds || []).filter(isRequalification).flatMap((refund) => refund.lines || []).filter(isCommissionLine)) {
    withheld[line.bucket] = round2((withheld[line.bucket] || 0) + Number(line.amountTtc || 0));
  }
  const rate = Number(vatRate || 0);

  const extras = [];
  for (const line of [...options, ...resources]) {
    if (!line || Number(line.offered || 0) === 1) continue;
    const key = billedLineKey(line);
    if (!key) continue;
    const billedTtc = round2(line.totalPrice);
    if (billedTtc <= 0) continue;
    const quantity = Number(line.billedUnits || line.quantity || 0) || null;
    extras.push({
      key,
      label: lineLabelOf(line),
      bucket: key.startsWith('res:') ? 'resources' : 'options',
      quantity,
      unitPrice: quantity ? round2(billedTtc / quantity) : null,
      billedTtc,
      vatRate: rate,
    });
  }

  const extrasTtc = round2([...options, ...resources]
    .reduce((sum, line) => sum + Number((line && line.totalPrice) || 0), 0));
  const accommodationTtc = Math.max(0, round2(Number(finalPrice || 0) - extrasTtc));

  const all = [];
  if (accommodationTtc > 0) {
    all.push({
      key: ACCOMMODATION_KEY,
      label: ACCOMMODATION_LABEL,
      bucket: 'accommodation',
      quantity: null,
      unitPrice: null,
      billedTtc: accommodationTtc,
      vatRate: rate,
    });
  }
  all.push(...extras);
  // Rule 49 reading of 2026-11-05 (D11) — a paid line removed since is offered back on what it collected, under its name.
  if (cancelled) {
    for (const line of goneLines) {
      if (all.some((other) => other.key === line.key)) continue;
      all.push({ key: line.key, label: line.label, bucket: line.bucket, quantity: null, unitPrice: null, billedTtc: line.collectedTtc, vatRate: rate });
    }
  }
  const taxTtc = round2(touristTaxTotal);
  if (taxTtc > 0) {
    // The tax is refunded BY NIGHT, never as a loose amount: the commune declaration removes whole
    // nights, so the unit the operator picks has to be the night itself (spec §3.5 rule 27). The unit
    // price is the whole party's tax for one night.
    const taxNights = Math.max(0, Math.round(Number(nights) || 0));
    all.push({
      key: TOURIST_TAX_KEY,
      label: TOURIST_TAX_LABEL,
      bucket: 'touristTax',
      quantity: taxNights || null,
      unitPrice: taxNights > 0 ? round2(taxTtc / taxNights) : null,
      unitLabel: taxNights > 0 ? 'nuit' : null,
      billedTtc: taxTtc,
      vatRate: 0, // a pass-through bears no VAT
    });
  }

  // A line whose billed amount shrank below what was already refunded clamps to 0 (spec §3.2 edge
  // case): the money physically left, but nothing more can be given back on that key. What a
  // cancellation requalified is told apart from what went back to the guest (rule 46).
  // What a refund took from the indemnity (rule 48) gave back requalified money, not the line's sale.
  const perLine = all.map((line) => {
    const refundedTtc = round2(given[line.key] || 0);
    const withheldTtc = line.key === ACCOMMODATION_KEY ? round2(withheld.accommodation || 0) : 0;
    const requalifiedTtc = round2((requalified[line.key] || 0) + withheldTtc);
    const saleRefundedTtc = round2(refundedTtc - (fromIndemnity[line.key] || 0));
    // Rule 49 reading of 2026-11-05 (audit R22-4) — a line lowered after it was paid still holds what it collected.
    const ceilingTtc = cancelled && collected && line.key in collected ? Math.max(line.billedTtc, Number(collected[line.key]) || 0) : line.billedTtc;
    return { ...line, ceilingTtc, refundedTtc, requalifiedTtc, withheldTtc, refundableTtc: Math.max(0, round2(ceilingTtc - saleRefundedTtc - requalifiedTtc)) };
  });
  // Rule 48 reading of 2026-11-02 (audit R15-L1) — what the caisse interne collected on a line (0 when it collected
  // nothing on the stay, unknown on a line no reading names) and gave back there: beyond that money, a caisse-interne
  // refund gave back the line's book money.
  const inCash = refundedByKey(refunds, (refund) => isOffBooks(refund.method));
  const hasCash = Boolean(cancelled) && Number(cancelled.cashCollectedTtc || 0) > 0;
  const cashOf = (line) => (!hasCash ? 0 : (cashCollected && line.key in cashCollected ? cashCollected[line.key] : Infinity));
  const cashLeftOf = (line) => Math.max(0, cashOf(line) - (inCash[line.key] || 0));
  const bookGivenOf = (line) => round2(line.refundedTtc - (fromIndemnity[line.key] || 0) - (inCash[line.key] || 0)
    + (cashOf(line) === Infinity ? 0 : Math.max(0, (inCash[line.key] || 0) - cashOf(line))));
  // Rule 49 reading of 2026-11-02 — on a cancelled stay a line never holds more than it collected, net of the sale
  // money already given back on it: a line paid at arrival and never collected requalifies nothing and offers nothing.
  const collectedLeft = (line) => (cancelled && collected && line.key in collected
    ? Math.max(0, round2(collected[line.key] - bookGivenOf(line))) : Infinity);
  // Rule 49 reading of 2026-11-02 (second review of PR #926) — the avoir is spread over the lines as they stood when
  // it was written: a refund made after it never moves its money from one line to another, so giving back one line
  // leaves what the others offer unchanged.
  const beforeAvoir = writtenBeforeAvoir(refunds);
  const saleBefore = refundedByKey(refunds, (refund) => !isRequalification(refund) && beforeAvoir(refund), (line) => !isIndemnityLine(line));
  const roomAtAvoir = (line) => {
    const before = saleBefore[line.key] || 0;
    const billed = Math.max(0, round2(line.ceilingTtc - before - line.requalifiedTtc));
    return cancelled && collected && line.key in collected ? Math.min(billed, Math.max(0, round2(collected[line.key] - before))) : billed;
  };
  ['options', 'resources'].forEach((bucket) => spreadBucketRefund(perLine.filter((line) => line.key !== bucket && line.bucket === bucket), requalified[bucket], roomAtAvoir));
  ['options', 'resources'].forEach((bucket) => spreadBucketRefund(perLine.filter((line) => line.key !== bucket && line.bucket === bucket), withheld[bucket], roomAtAvoir, true));
  if (cancelled) {
    // Rule 48 — a cancelled stay gives back money it collected, never what it billed: the requalified money the
    // indemnity still holds on the line, plus at most the collected money no cancellation requalified.
    const saleRooms = perLine.map((line) => Math.round(Math.min(line.refundableTtc, cancelled.saleLeftTtc,
      Math.max(0, collectedLeft(line) - line.requalifiedTtc)) * 100));
    const indemnityRooms = perLine.map((line) => Math.round(Math.min(cancelled.indemnityLeftTtc,
      Math.max(0, round2(line.requalifiedTtc - line.withheldTtc - (fromIndemnity[line.key] || 0)))) * 100));
    // Rule 49 — the lines together never offer more than is left: a free line took its money from no line in
    // particular, and a paid solde is one sum the lines share. The excess comes off the lines paid at arrival first,
    // the money a cancelled stay is the least likely to have collected, then off the lines whose own collection is
    // unknown, the lines capped at what they collected last.
    const atArrival = new Set([...options, ...resources].filter((line) => line && Number(line.inComplement || 0) === 1).map(billedLineKey));
    // Reading of 2026-11-05 (audit R22-2) — the arrival rank holds while the complement is unpaid: once paid, those lines
    // are the very lines that collected.
    const rank = (line) => (atArrival.has(line.key) && !complementCollected ? 0 : (collectedLeft(line) === Infinity ? 1 : 2));
    const order = perLine.map((line, index) => index).sort((a, b) => rank(perLine[a]) - rank(perLine[b]) || a - b);
    capInOrder(saleRooms, Math.round(cancelled.saleLeftTtc * 100), order);
    capInOrder(indemnityRooms, Math.round(cancelled.indemnityLeftTtc * 100), order);
    // Rule 49 reading of 2026-11-02 (second review of PR #926) — the cents the per-line caps leave unoffered (the
    // roundings of a stored-money split: a bucket booked a cent above what it billed, another a cent below) are
    // offered on the line with the most room left within what it billed, so giving everything back leaves nothing.
    let unoffered = Math.round(cancelled.saleLeftTtc * 100) - saleRooms.reduce((total, cents) => total + cents, 0);
    if (unoffered > 0 && unoffered <= Math.round(STORED_SPLIT_ROUNDING_TTC * 100)) {
      const headroom = perLine.map((line, index) => Math.round(Math.min(line.refundableTtc, cancelled.saleLeftTtc) * 100) - saleRooms[index]);
      const ranked = perLine.map((line, index) => index).sort((a, b) => headroom[b] - headroom[a] || a - b);
      for (const index of ranked) {
        const added = Math.min(unoffered, Math.max(0, headroom[index]));
        saleRooms[index] += added;
        unoffered -= added;
      }
    }
    // Rule 48 reading of 2026-11-02 (audit R15-L1) — the caisse interne's own money, within what the line billed.
    const cashRooms = perLine.map((line, index) => Math.max(0, Math.round(Math.min(
      Math.round(line.refundableTtc * 100) - saleRooms[index], cashLeftOf(line) * 100, Number(cancelled.cashLeftTtc || 0) * 100,
    ))));
    capInOrder(cashRooms, Math.round(Number(cancelled.cashLeftTtc || 0) * 100), order);
    perLine.forEach((line, index) => {
      line.indemnityTtc = indemnityRooms[index] / 100;
      if (cashRooms[index] > 0) line.cashTtc = cashRooms[index] / 100;
      line.refundableTtc = (saleRooms[index] + indemnityRooms[index] + cashRooms[index]) / 100;
    });
  } else if (collected) {
    applyLiveCollected(perLine, { collected, refunds, planBuckets, reservation });
  }
  return perLine.filter((line) => line.refundableTtc > 0).map(({ withheldTtc, ceilingTtc, ...line }) => line);
}

/**
 * Rule 51 (D15) — on a live stay each line says what a book refund can still take on it: `availableTtc`, the figure the
 * dialog blocks on. A line a reading names is capped by what it collected, net of the book refunds already made on it. A
 * plan's installments know the bucket, not the line: the lines no reading names share the bucket (`sharedBucket`). Other
 * lines no reading names (money no contrib describes) carry no figure: the total alone judges them.
 */
function applyLiveCollected(perLine, { collected, refunds, planBuckets, reservation }) {
  const given = refundedByKey(refunds, (refund) => !isOffBooks(refund.method) && !isRetainedDeposit(refund.method));
  const shared = {};
  if (planBuckets) {
    const unnamed = perLine.filter((line) => !(line.key in collected));
    const late = reservation ? collectedAfterArrival(reservation) : new Map();
    for (const { bucket } of PLAN_BUCKET_LINES) {
      const inBucket = unnamed.filter((line) => line.bucket === bucket);
      shared[bucket] = Math.max(0, round2(inBucket.reduce((sum, line) => sum + (late.has(line.key) ? late.get(line.key).amount : 0) - (given[line.key] || 0), Number(planBuckets[bucket]) || 0)));
    }
  }
  for (const line of perLine) {
    if (line.key in collected) {
      line.availableTtc = Math.min(line.refundableTtc, Math.max(0, round2(collected[line.key] - (given[line.key] || 0))));
    } else if (planBuckets && line.bucket in shared) {
      line.availableTtc = Math.min(line.refundableTtc, shared[line.bucket]);
      line.sharedBucketTtc = shared[line.bucket];
    }
  }
}

// specs/reservation-refunds.md rule 49 — lowers the rooms (cents) until they add up to `budget` at most, taking the
// excess off the lines in `order` (accommodation, the extras, the tourist tax, unless rule 49's reading ranks them).
function capInOrder(rooms, budget, order) {
  let excess = rooms.reduce((total, cents) => total + cents, 0) - Math.max(0, budget);
  for (const index of order) {
    if (excess <= 0) break;
    const taken = Math.min(excess, rooms[index]);
    rooms[index] -= taken;
    excess -= taken;
  }
}

/**
 * A line keyed by its bucket (`options`, `resources`) names no billed line: it is the requalification avoir of
 * a cancellation, which reverses a whole bucket (specs/reservation-refunds.md rule 45). It consumes the
 * bucket's lines pro rata of what each still had to give back when it was written (`roomOf`), by largest remainder
 * (rule 46): every cent of it lands on a line that still had it, so the register never offers again what the
 * cancellation requalified. `withheldShare`: the amount is a commission withheld (rule 48 reading of 2026-11-02), which
 * the indemnity never gives back.
 */
function spreadBucketRefund(lines, amountTtc, roomOf = (line) => line.refundableTtc, withheldShare = false) {
  const totalCents = Math.round(Number(amountTtc || 0) * 100);
  const remaining = lines.filter((line) => roomOf(line) > 0);
  const lineCents = remaining.map((line) => Math.round(roomOf(line) * 100));
  const availableCents = lineCents.reduce((sum, c) => sum + c, 0);
  if (totalCents <= 0 || availableCents <= 0) return;
  const spentCents = Math.min(totalCents, availableCents);
  const takes = lineCents.map((c) => Math.floor((spentCents * c) / availableCents));
  let leftCents = spentCents - takes.reduce((sum, c) => sum + c, 0);
  lineCents
    .map((c, index) => ({ index, rest: (spentCents * c) % availableCents }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
    .forEach(({ index }) => {
      if (leftCents <= 0 || takes[index] >= lineCents[index]) return;
      takes[index] += 1;
      leftCents -= 1;
    });
  remaining.forEach((line, index) => {
    line.requalifiedTtc = round2(line.requalifiedTtc + takes[index] / 100);
    if (withheldShare) line.withheldTtc = round2(line.withheldTtc + takes[index] / 100);
    line.refundableTtc = Math.max(0, round2(line.refundableTtc - takes[index] / 100));
  });
}

module.exports = {
  budget,
  refundable,
  applyLiveCollected,
  capInOrder,
  spreadBucketRefund,
};
