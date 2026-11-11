/**
 * REFUNDS / judge — the refusals and the write judge of the register (rule 72).
 *
 * `validateRefundPayload` (caps per line, per stay, on the cancelled budget; `today` injected), `splitOnIndemnity` (a
 * cancelled stay's refund taken caisse, then sale, then indemnity), `refundDeletionRefusal`, and `untickRefusal` (taking a
 * mark back must not leave book refunds above what stays collected, rule 52; the projected split is injected by the
 * caller). Moved from `utils/refunds.js` and `utils/refundUntickGuard.js`. Pure but for the two lazy reads of a label
 * formatter. Keeps its own `round2`.
 */

const { comptaCollected } = require('../../reservationSettlement');
const { cashDepositKeptOf } = require('./cancellation');
const { parseNotes } = require('../../midStayExtras');
const { dateWindowMessage, isRealIsoDay } = require('../../stayDates');
const { INDEMNITY_BUCKET, OFF_BOOKS_METHOD, REFUND_BUCKETS, SELECTABLE_REFUND_METHODS, isOffBooks, isRequalification, isRetainedDeposit, madeAfterCancellation, nettedByCancellation } = require('./register');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Payment-schedule rule 55 reading of 2026-11-02 (review of PR #929, F2) — whether the cancellation had book money to
 * keep: a paid acompte or paid installments, or a commission withheld on a paid solde. A stay paid in full with no
 * commission had none: its cancellation read no refund, whatever was given back before it.
 */
function cancellationHadBookMoney(row) {
  const book = (paid, cash) => Number(row[paid]) === 1 && !Number(row[cash] || 0);
  return (book('depositPaid', 'depositPaidCash') && round2(row.depositAmount) > 0)
    || round2(row.installmentsPaidAmount) > 0
    || (book('balancePaid', 'balancePaidCash') && round2(row.platformCommissionAmount) > 0);
}

const DELETION_REFUSALS = {
  retained: { code: 'REFUND_RETAINED_AVOIR', error: 'L’indemnité d’annulation ne se supprime pas.' },
  netted: { code: 'REFUND_NETTED_BY_CANCELLATION', error: 'Remboursement déduit de l’acompte conservé.' },
  before: { code: 'REFUND_BEFORE_CANCELLATION', error: 'Remboursement antérieur à l’annulation.' },
  keptSum: { code: 'REFUND_NETTED_BY_CANCELLATION', error: 'Remboursement déduit de la somme conservée.' },
};

/**
 * Why a refund of the register cannot be deleted, or null (rule 6 reading of 2026-11-02): the `retained` avoir is the
 * cancellation itself; on a cancelled stay a book refund made before the cancellation was read by it (netted from the
 * avoir, or the reason it kept nothing). A caisse-interne refund is off the books: the cancellation never read it. A
 * cancellation that had no book money to keep read no refund either (review of PR #929, F2). Shared by the DELETE
 * route and the ledger, so the fiche offers exactly what the server accepts.
 * Payment-schedule rule 55 reading of 2026-11-02 (audit R16-L1) — with an avoir and its `nettedIds`, a book refund
 * before it that the avoir never read (the paid solde absorbed it whole) is deleted: its money goes back to the solde.
 */
function caisseKeptMoves(refund, refunds, row) {
  const before = (refunds || []).filter((r) => !madeAfterCancellation(r, refunds, row.cancelledAt));
  const without = before.filter((r) => r !== refund && !(r.id != null && refund.id != null && Number(r.id) === Number(refund.id)));
  return cashDepositKeptOf(row, without) !== cashDepositKeptOf(row, before);
}

function refundDeletionRefusal(refund, refunds, reservation, nettedIds = null) {
  if (!refund) return null;
  if (isRetainedDeposit(refund.method)) return DELETION_REFUSALS.retained;
  const row = reservation || {};
  if (String(row.kind) !== 'cancelled') return null;
  if (nettedByCancellation(refund, refunds, nettedIds)) return DELETION_REFUSALS.netted;
  // Payment-schedule rule 62 reading (verification R44b N1) — since rule 61 the sum kept reads the caisse acompte net of
  // the caisse refunds made before the cancel: deleting one of those would raise a sum the notice already stated.
  if (isOffBooks(refund.method) && !madeAfterCancellation(refund, refunds, row.cancelledAt)
    && caisseKeptMoves(refund, refunds, row)) return DELETION_REFUSALS.keptSum;
  if (isOffBooks(refund.method) || madeAfterCancellation(refund, refunds, row.cancelledAt)) return null;
  if (nettedIds && (refunds || []).some(isRequalification)) return null;
  return cancellationHadBookMoney(row) ? DELETION_REFUSALS.before : null;
}

/**
 * specs/reservation-refunds.md rule 53 (verification R35b, finding 5) — the latest day a payment of the stay reached the
 * books: a paid acompte, solde, arrival or end-of-stay complement off the caisse interne, a paid installment, a note
 * settled on the books, a settlement with a book tender. `null` when none did. A book refund dated before it is refused:
 * the refund closing the stay's books (mixed-method-payments rules 56, 58) reads the encaissements up to its own date.
 */
function lastBookPaymentDateOf(row, { installments = [], settlements = [] } = {}) {
  const r = row || {};
  const days = [];
  for (const [flag, cash, date] of [
    ['depositPaid', 'depositPaidCash', 'depositPaidDate'],
    ['balancePaid', 'balancePaidCash', 'balancePaidDate'],
    ['complementPaid', 'complementPaidCash', 'complementPaidDate'],
    ['endOfStayComplementPaid', 'endOfStayComplementPaidCash', 'endOfStayComplementPaidDate'],
  ]) if (Number(r[flag]) === 1 && !Number(r[cash] || 0)) days.push(r[date]);
  for (const installment of installments) if (Number(installment.paid) === 1) days.push(installment.paidDate);
  for (const note of parseNotes(r.midStaySettledNotes)) if (note && !Number(note.paidCash || 0)) days.push(note.paidDate);
  for (const settlement of settlements) {
    if ((settlement.tenders || []).some((t) => !(Number(t.internal) === 1 || t.internal === true) && Number(t.amountCents) > 0)) days.push(settlement.paidDate);
  }
  const real = days.map((day) => String(day || '').slice(0, 10)).filter(isRealIsoDay).sort();
  return real.length ? real[real.length - 1] : null;
}

function invalid(code, error, status = 400) {
  return { code, error, status };
}

/**
 * Validate + normalize a refund creation payload (spec §3.2 rules 9–14).
 *
 * Keyed lines take their bucket, unit price and VAT rate from the refundable line — the client only
 * chooses *how much*. Free lines carry an operator-chosen bucket and no cap of their own; they are
 * still bound by the global cap.
 *
 * @returns {{error: string, code: string, status: number}|{refund: object}}
 */
function validateRefundPayload(payload, context) {
  const {
    refundableLines = [], finalPrice = 0, touristTaxTotal = 0,
    alreadyRefundedTotal = 0, vatRate = 0, today, cancelled = null, liveCollectedTtc = null, lastBookPaymentDate = null,
  } = context || {};

  const refundDate = String((payload && payload.refundDate) || '').trim();
  if (!isRealIsoDay(refundDate)) {
    return invalid('REFUND_INVALID_DATE', 'Date de remboursement invalide');
  }
  if (today && refundDate > today) {
    return invalid('REFUND_INVALID_DATE', 'La date de remboursement ne peut pas être dans le futur');
  }
  // specs/reservations-backend-mvc.md rule 13 (reading of 2026-11-02) — not before today − 5 years.
  const outside = dateWindowMessage(refundDate, today || undefined);
  if (outside) return invalid('REFUND_INVALID_DATE', outside);

  // Operator-facing methods only: `retained` is written by the cancellation flow, never requested.
  const method = String((payload && payload.method) || 'transfer');
  if (!SELECTABLE_REFUND_METHODS.includes(method)) {
    return invalid('REFUND_INVALID_METHOD', 'Moyen de remboursement inconnu');
  }
  // Rule 53 — a book refund is never dated before the stay's last book payment.
  if (!isOffBooks(method) && lastBookPaymentDate && refundDate < lastBookPaymentDate) {
    const [y, m, d] = lastBookPaymentDate.split('-');
    return invalid('REFUND_BEFORE_PAYMENT', `Date antérieure au dernier paiement (${d}/${m}/${y}).`);
  }

  const rawLines = Array.isArray(payload && payload.lines) ? payload.lines : [];
  if (rawLines.length === 0) {
    return invalid('REFUND_INVALID_AMOUNT', 'Aucune ligne à rembourser');
  }

  const byKey = new Map(refundableLines.map((l) => [l.key, l]));
  const requestedByKey = {};
  const lines = [];

  for (const raw of rawLines) {
    const amountTtc = round2(raw && raw.amountTtc);
    if (!(amountTtc > 0)) {
      return invalid('REFUND_INVALID_AMOUNT', 'Chaque ligne remboursée doit porter un montant positif');
    }
    const key = raw && raw.key ? String(raw.key) : null;

    if (key) {
      const billed = byKey.get(key);
      if (!billed) {
        return invalid('REFUND_UNKNOWN_LINE', 'Cette prestation n’est pas remboursable sur cette réservation');
      }
      requestedByKey[key] = round2((requestedByKey[key] || 0) + amountTtc);
      if (requestedByKey[key] > billed.refundableTtc) {
        return invalid(
          'REFUND_EXCEEDS_LINE',
          `« ${billed.label} » : le remboursement dépasse le montant restant remboursable (${euros(billed.refundableTtc)})`,
          409,
        );
      }
      // Quantity is DERIVED from the amount, never trusted from the client: it is what the tourist-tax
      // declaration deducts in nights (spec §3.5 rule 28), so amount and quantity can never disagree.
      const unitPrice = Number(billed.unitPrice) > 0 ? Number(billed.unitPrice) : null;
      const quantity = unitPrice ? Math.round((amountTtc / unitPrice) * 10000) / 10000 : null;
      lines.push({
        lineKey: key,
        label: billed.label,
        bucket: billed.bucket,
        quantity,
        unitPrice,
        amountTtc,
        vatRate: billed.vatRate,
      });
      continue;
    }

    // Free line — the commercial-gesture escape hatch (rule 9).
    const label = String((raw && raw.label) || '').trim();
    if (!label) {
      return invalid('REFUND_INVALID_LINE', 'Une ligne libre doit porter un libellé');
    }
    const bucket = String((raw && raw.bucket) || 'options');
    if (!REFUND_BUCKETS.includes(bucket)) {
      return invalid('REFUND_INVALID_LINE', 'Catégorie de remboursement inconnue');
    }
    lines.push({
      lineKey: null,
      label,
      bucket,
      quantity: null,
      unitPrice: null,
      amountTtc,
      vatRate: bucket === 'touristTax' ? 0 : Number(vatRate || 0),
    });
  }

  const totalTtc = round2(lines.reduce((sum, l) => sum + l.amountTtc, 0));
  if (cancelled) {
    const reachable = round2(cancelled.collectedTtc + Number(cancelled.cashLeftTtc || 0));
    if (totalTtc > reachable) {
      return invalid('REFUND_EXCEEDS_COLLECTED', `Dépasse l’encaissé (${euros(reachable)}).`, 409);
    }
    const split = splitOnIndemnity(lines, byKey, cancelled, method === OFF_BOOKS_METHOD);
    if (split.error) return split;
    lines.splice(0, lines.length, ...split.lines);
  }
  if (!(totalTtc > 0)) {
    return invalid('REFUND_INVALID_AMOUNT', 'Le montant total du remboursement doit être positif');
  }
  // Rule 50 (D10) — on a live stay too, a book refund never exceeds what was collected: money never received cannot go back.
  if (!cancelled && !isOffBooks(method) && liveCollectedTtc != null && totalTtc > round2(liveCollectedTtc)) {
    return invalid('REFUND_EXCEEDS_COLLECTED', `Dépasse l’encaissé (${euros(Math.max(0, round2(liveCollectedTtc)))}).`, 409);
  }
  // Rule 51 (D15) — within that total, a line gives back what it collected. Free lines answer to the total alone.
  if (!cancelled && !isOffBooks(method)) {
    const refused = (left) => invalid('REFUND_EXCEEDS_LINE_COLLECTED', left > 0 ? `Disponible sur cette ligne : ${euros(left)}.` : 'Rien d’encaissé sur cette ligne.', 409);
    const sharedAsked = {};
    for (const [key, asked] of Object.entries(requestedByKey)) {
      const line = byKey.get(key);
      if (line.availableTtc != null && asked > line.availableTtc) return refused(line.availableTtc);
      if (line.sharedBucketTtc == null) continue;
      sharedAsked[line.bucket] = round2((sharedAsked[line.bucket] || 0) + asked);
      if (sharedAsked[line.bucket] > line.sharedBucketTtc) return refused(Math.max(0, round2(line.sharedBucketTtc - sharedAsked[line.bucket] + asked)));
    }
  }

  // Rule 49 reading of 2026-11-05 (audit R22-4) — a cancelled stay is judged by what it collected (above), never by what
  // it still bills: a line lowered or removed since would make that money unreachable.
  const stayCap = round2(Number(finalPrice || 0) + Number(touristTaxTotal || 0));
  if (!cancelled && round2(Number(alreadyRefundedTotal || 0) + totalTtc) > stayCap) {
    return invalid(
      'REFUND_EXCEEDS_STAY',
      `Le total remboursé dépasserait le montant du séjour (${stayCap.toFixed(2).replace('.', ',')} €).`,
      409,
    );
  }

  return {
    refund: {
      refundDate,
      method,
      reason: String((payload && payload.reason) || '').trim(),
      totalTtc,
      lines,
    },
  };
}

// Lazy: reservationLedger requires this module.
const euros = (n) => require('../../reservationLedger').formatEuros(n);

/**
 * Rule 48 — on a cancelled stay, each line is given back first from the collected money no cancellation
 * requalified (it keeps its bucket and VAT: the sale is reversed), then from the indemnity (bucket `indemnity`,
 * 0 %). The indemnity part of a sold line never exceeds what the cancellation requalified on it.
 * Rule 48 reading of 2026-11-02 (audit R15-L1) — a caisse-interne refund takes the caisse interne's own money first,
 * then the sale money, never the indemnity; a book refund never takes the caisse interne's money.
 */
function splitOnIndemnity(lines, byKey, budget, offBooks = false) {
  let saleLeft = Math.round(budget.saleLeftTtc * 100);
  let indemnityLeft = Math.round(budget.indemnityLeftTtc * 100);
  let cashLeft = Math.round(Number(budget.cashLeftTtc || 0) * 100);
  const saleRoom = {};
  const indemnityRoom = {};
  const cashRoom = {};
  for (const [key, line] of byKey) {
    indemnityRoom[key] = Math.round(Number(line.indemnityTtc || 0) * 100);
    cashRoom[key] = Math.round(Number(line.cashTtc || 0) * 100);
    saleRoom[key] = Math.round(line.refundableTtc * 100) - indemnityRoom[key] - cashRoom[key];
  }
  const out = [];
  for (const line of lines) {
    const cents = Math.round(line.amountTtc * 100);
    const key = line.lineKey;
    const room = (rooms, left) => Math.min(left, key ? Math.max(0, rooms[key]) : left);
    const cash = offBooks ? Math.min(cents, room(cashRoom, cashLeft)) : 0;
    const sale = Math.min(cents - cash, room(saleRoom, saleLeft));
    const fromIndemnity = cents - cash - sale;
    if (fromIndemnity > 0 && (offBooks || fromIndemnity > room(indemnityRoom, indemnityLeft))) {
      const billed = key ? byKey.get(key) : null;
      // Rule 49 — what is really left for this line once the earlier lines of the refund took their share.
      const leftCents = room(saleRoom, saleLeft) + room(indemnityRoom, indemnityLeft) + room(cashRoom, cashLeft);
      if (offBooks && fromIndemnity <= room(indemnityRoom, indemnityLeft)) {
        return invalid('REFUND_INDEMNITY_OFF_BOOKS', 'Pris sur l’indemnité : virement ou espèces seulement.', 409);
      }
      if (!offBooks && cents <= leftCents) {
        return invalid('REFUND_CASH_ONLY_IN_CASH', 'Encaissé en caisse interne : rendu en caisse interne seulement.', 409);
      }
      return billed
        ? invalid('REFUND_EXCEEDS_LINE', `« ${billed.label} » : dépasse l’encaissé restant (${euros(leftCents / 100)}).`, 409)
        : invalid('REFUND_EXCEEDS_COLLECTED', `Dépasse l’encaissé restant (${euros(leftCents / 100)}).`, 409);
    }
    saleLeft -= sale;
    indemnityLeft -= fromIndemnity;
    cashLeft -= cash;
    if (key) {
      saleRoom[key] -= sale;
      indemnityRoom[key] -= fromIndemnity;
      cashRoom[key] -= cash;
    }
    const part = (amountCents) => ({
      ...line,
      amountTtc: amountCents / 100,
      quantity: line.unitPrice ? Math.round((amountCents / 100 / line.unitPrice) * 10000) / 10000 : line.quantity,
    });
    if (cash + sale > 0) out.push(part(cash + sale));
    if (fromIndemnity > 0) out.push({ ...part(fromIndemnity), bucket: INDEMNITY_BUCKET, vatRate: 0 });
  }
  return { lines: out };
}

const formatEuros = (n) => require('../../reservationLedger').formatEuros(n);

const frenchDay = (iso) => {
  const [year, month, day] = String(iso || '').slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
};

/**
 * @param {object} row     the stay as stored
 * @param {object} changes the columns the gesture would write
 * @param {Array}  refunds the stay's register
 * @returns {{status: number, body: object}|null} the refusal, or null
 */
function untickRefusal(row, changes, refunds, projectedSplit) {
  const book = (refunds || []).filter((refund) => !isOffBooks(refund.method) && !isRetainedDeposit(refund.method));
  // Nothing refunded on the books: nothing to protect (rule 52 reading « nothing refunded = as before »).
  if (book.length === 0) return null;
  const before = comptaCollected({ ...row, refundsBookTtc: 0 });
  // specs/mixed-method-payments.md rules 13, 42 — the split aggregates are read for the state the gesture writes: a
  // payment taken back takes its settlement with it (only ITS settlements: the other split payments of the stay keep
  // their deduction), and an amount that moves is read at its new amount (rule 39).
  const splitAfter = projectedSplit({ ...row, ...changes });
  const after = comptaCollected({ ...row, ...changes, ...splitAfter, refundsBookTtc: 0 });
  if (after >= before) return null;
  let shortfall = round2(book.reduce((sum, refund) => sum + Number(refund.totalTtc || 0), 0) - after);
  if (shortfall <= 0) return null;
  const named = [];
  for (const refund of [...book].sort((a, b) => Number(b.id) - Number(a.id))) {
    if (shortfall <= 0) break;
    named.push(refund);
    shortfall = round2(shortfall - Number(refund.totalTtc || 0));
  }
  const list = named.map((refund) => `du ${frenchDay(refund.refundDate)} (${formatEuros(refund.totalTtc)})`).join(', ');
  return {
    status: 409,
    body: {
      error: `${named.length > 1 ? 'Remboursements' : 'Remboursement'} ${list} à supprimer d’abord.`,
      code: 'REFUND_BLOCKS_UNTICK',
      refundIds: named.map((refund) => refund.id),
    },
  };
}

module.exports = {
  lastBookPaymentDateOf,
  validateRefundPayload,
  splitOnIndemnity,
  cancellationHadBookMoney,
  caisseKeptMoves,
  refundDeletionRefusal,
  untickRefusal,
};
