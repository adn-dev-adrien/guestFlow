/**
 * Remboursements — specs/reservation-refunds.md.
 *
 * A refund is an « avoir »: money returned to the guest AFTER the sale, with its own date, WITHOUT
 * touching the sale. The sale keeps its price, its échéances and its paid flags; the refund lives in
 * its own register and is subtracted downstream (fiche total, finance aggregates, CA) and mirrored
 * as a reversed journal entry in the monthly export.
 *
 * Everything here is pure (no DB, no clock — `today` is injected): the caps, the refundable-line
 * derivation and the HT/VAT split are unit-testable in isolation. Persistence belongs to
 * models/refundsModel.js, orchestration to controllers/refundsController.js.
 */

const { extraLineKey } = require('./midStayExtras');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Means of refund. `transfer` + `cash` are book money; `internal` (caisse interne) stays off the
// books, exactly like the cash complements (specs/cash-complement-and-endofstay-finance.md).
// `retained` is book money too, but no money moves: it is the requalification avoir written when a
// stay is cancelled for non-payment and the acompte is kept as an indemnity
// (specs/payment-schedule-and-cancellation.md §3.6 rule 32). It is never operator-selectable — only
// the cancellation flow writes it — so it stays out of `SELECTABLE_REFUND_METHODS`.
const REFUND_METHODS = ['transfer', 'cash', 'internal', 'retained'];
const SELECTABLE_REFUND_METHODS = ['transfer', 'cash', 'internal'];
const RETAINED_DEPOSIT_METHOD = 'retained';
const OFF_BOOKS_METHOD = 'internal';

// Revenue/pass-through buckets a refund line can land in. Mirrors the accounting buckets, plus the
// tourist tax which is a pass-through (no VAT, no revenue account).
const REFUND_BUCKETS = ['accommodation', 'options', 'resources', 'touristTax'];

// On a cancelled stay, the share of a manual refund the indemnity pays (specs/reservation-refunds.md rule 48): no
// revenue, no VAT — the export debits the indemnity account the cancellation credited. Never operator-selectable.
const INDEMNITY_BUCKET = 'indemnity';

const ACCOMMODATION_KEY = 'accommodation';
const TOURIST_TAX_KEY = 'touristTax';

const ACCOMMODATION_LABEL = 'Hébergement';
const TOURIST_TAX_LABEL = 'Taxe de séjour';

function isOffBooks(method) {
  return String(method) === OFF_BOOKS_METHOD;
}

// A `retained` avoir reverses revenue in the JOURNAL, but no money ever left our account: the acompte
// stayed, requalified as an indemnity (specs/payment-schedule-and-cancellation.md §3.6). So every
// reader that answers « how much did we give back to this guest » must skip it — otherwise a cancelled
// stay reads as a refund on the fiche and in the finance aggregates, which is the exact opposite of
// what happened. The monthly journal read (`listByMonth`) deliberately keeps it.
function isRetainedDeposit(method) {
  return String(method) === RETAINED_DEPOSIT_METHOD;
}

/**
 * Stable key of a billed line, shared with the mid-stay register so the two features never disagree
 * on line identity (`opt:<id>` / `res:<id>` / `custom:<label>`).
 */
function billedLineKey(line) {
  return extraLineKey(line);
}

function lineLabelOf(line) {
  return String(line.title || line.name || line.description || 'Prestation').trim() || 'Prestation';
}

/**
 * `{ key → TTC already refunded }` over a reservation's whole refund register (every means). `filter`
 * keeps only some refunds — `isRequalification` for the money a cancellation requalified.
 */
function refundedByKey(refunds, filter = () => true, lineFilter = () => true) {
  const byKey = {};
  for (const refund of (refunds || []).filter(filter)) {
    for (const line of refund.lines || []) {
      if (!line.lineKey || !lineFilter(line)) continue;
      byKey[line.lineKey] = round2((byKey[line.lineKey] || 0) + Number(line.amountTtc || 0));
    }
  }
  return byKey;
}

// A `retained` avoir gives nothing back: it requalifies money a cancellation kept as an indemnity
// (payment-schedule spec §3.6).
const isRequalification = (refund) => String((refund && refund.method) || '') === 'retained';

const isIndemnityLine = (line) => String((line && line.bucket) || '') === INDEMNITY_BUCKET;

/**
 * What a cancelled stay can still give back (specs/reservation-refunds.md rule 48). `collectedTtc` is the book
 * money it collected, net of every book refund (`comptaCollected`). Of it, `indemnityLeftTtc` is what the
 * cancellation requalified and no refund has taken from the indemnity yet; `saleLeftTtc` is the rest — a paid
 * solde, say — which a refund still reverses as revenue + VAT.
 */
function cancelledRefundBudget({ collectedTtc, refunds = [] }) {
  const collected = Math.max(0, round2(collectedTtc));
  const requalified = (refunds || []).filter(isRequalification).reduce((sum, r) => sum + Number(r.totalTtc || 0), 0);
  const fromIndemnity = (refunds || []).filter((r) => !isRequalification(r))
    .flatMap((r) => r.lines || []).filter(isIndemnityLine)
    .reduce((sum, l) => sum + Number(l.amountTtc || 0), 0);
  const indemnityLeftTtc = Math.min(collected, Math.max(0, round2(requalified - fromIndemnity)));
  return { collectedTtc: collected, indemnityLeftTtc, saleLeftTtc: round2(collected - indemnityLeftTtc) };
}

/** Σ of the refund register, either book-money only (default) or including the caisse interne. */
function refundsTotal(refunds, { withCash = false } = {}) {
  return round2((refunds || [])
    .filter((r) => withCash || !isOffBooks(r.method))
    .reduce((sum, r) => sum + Number(r.totalTtc || 0), 0));
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
 * @param {object} [input.cancelled]    `cancelledRefundBudget` of a cancelled stay: each line then offers what it
 *                                      collected (rule 48) and carries `indemnityTtc`, the part the indemnity holds
 */
function buildRefundableLines({ finalPrice, touristTaxTotal, vatRate, options = [], resources = [], refunds = [], nights = 0, cancelled = null }) {
  const given = refundedByKey(refunds, (refund) => !isRequalification(refund));
  const fromIndemnity = refundedByKey(refunds, (refund) => !isRequalification(refund), isIndemnityLine);
  const requalified = refundedByKey(refunds, isRequalification);
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
    const requalifiedTtc = round2(requalified[line.key] || 0);
    const saleRefundedTtc = round2(refundedTtc - (fromIndemnity[line.key] || 0));
    return { ...line, refundedTtc, requalifiedTtc, refundableTtc: Math.max(0, round2(line.billedTtc - saleRefundedTtc - requalifiedTtc)) };
  });
  ['options', 'resources'].forEach((bucket) => spreadBucketRefund(perLine.filter((line) => line.key !== bucket && line.bucket === bucket), requalified[bucket]));
  if (cancelled) {
    // Rule 48 — a cancelled stay gives back money it collected, never what it billed: the requalified money the
    // indemnity still holds on the line, plus at most the collected money no cancellation requalified.
    for (const line of perLine) {
      const saleRoomTtc = Math.min(line.refundableTtc, cancelled.saleLeftTtc);
      line.indemnityTtc = Math.min(cancelled.indemnityLeftTtc, Math.max(0, round2(line.requalifiedTtc - (fromIndemnity[line.key] || 0))));
      line.refundableTtc = Math.min(cancelled.collectedTtc, round2(saleRoomTtc + line.indemnityTtc));
    }
  }
  return perLine.filter((line) => line.refundableTtc > 0);
}

/**
 * A line keyed by its bucket (`options`, `resources`) names no billed line: it is the requalification avoir of
 * a cancellation, which reverses a whole bucket (specs/reservation-refunds.md rule 45). It consumes the
 * bucket's lines pro rata of what each still had to give back, by largest remainder (rule 46): every cent
 * of it lands on a line that still had it, so the register never offers again what the cancellation
 * requalified.
 */
function spreadBucketRefund(lines, amountTtc) {
  const totalCents = Math.round(Number(amountTtc || 0) * 100);
  const remaining = lines.filter((line) => line.refundableTtc > 0);
  const lineCents = remaining.map((line) => Math.round(line.refundableTtc * 100));
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
    line.refundableTtc = round2((lineCents[index] - takes[index]) / 100);
  });
}

/**
 * What a reservation gave back on its TOURIST TAX (specs/reservation-refunds.md §3.5).
 *
 * Counts EVERY means, caisse interne included: « hors comptabilité » only ever meant « out of the
 * turnover ». Towards the commune what matters is that the tax physically went back to the guest, so
 * it is not owed — whatever envelope it left in.
 *
 * `nights` is rounded to a whole night: the declaration counts nights, not fractions. A token refund
 * smaller than half a night therefore removes 0 night and only shrinks the amount.
 */
function refundedTouristTax(refunds) {
  let amount = 0;
  let nights = 0;
  for (const refund of refunds || []) {
    for (const line of refund.lines || []) {
      if (line.lineKey !== TOURIST_TAX_KEY) continue;
      amount = round2(amount + Number(line.amountTtc || 0));
      nights += Number(line.quantity || 0);
    }
  }
  return { amount, nights: Math.max(0, Math.round(nights)) };
}

/** Split a TTC amount into HT + VAT at the line's frozen rate. A 0-rate line is entirely HT. */
function splitHtVat(amountTtc, vatRate) {
  const ttc = round2(amountTtc);
  const rate = Number(vatRate || 0);
  if (!ttc) return { ht: 0, vat: 0 };
  if (rate <= 0) return { ht: ttc, vat: 0 };
  const vat = round2(ttc * (rate / (100 + rate)));
  return { ht: round2(ttc - vat), vat };
}

function invalid(code, error, status = 400) {
  return { code, error, status };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    alreadyRefundedTotal = 0, vatRate = 0, today, cancelled = null,
  } = context || {};

  const refundDate = String((payload && payload.refundDate) || '').trim();
  if (!ISO_DATE.test(refundDate)) {
    return invalid('REFUND_INVALID_DATE', 'Date de remboursement invalide');
  }
  if (today && refundDate > today) {
    return invalid('REFUND_INVALID_DATE', 'La date de remboursement ne peut pas être dans le futur');
  }

  // Operator-facing methods only: `retained` is written by the cancellation flow, never requested.
  const method = String((payload && payload.method) || 'transfer');
  if (!SELECTABLE_REFUND_METHODS.includes(method)) {
    return invalid('REFUND_INVALID_METHOD', 'Moyen de remboursement inconnu');
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
          `« ${billed.label} » : le remboursement dépasse le montant restant remboursable (${billed.refundableTtc.toFixed(2)} €)`,
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
    const split = splitOnIndemnity(lines, byKey, cancelled);
    if (split.error) return split;
    if (method === OFF_BOOKS_METHOD && split.lines.some(isIndemnityLine)) {
      return invalid('REFUND_INDEMNITY_OFF_BOOKS', 'Pris sur l’indemnité : virement ou espèces seulement.', 409);
    }
    lines.splice(0, lines.length, ...split.lines);
  }
  if (!(totalTtc > 0)) {
    return invalid('REFUND_INVALID_AMOUNT', 'Le montant total du remboursement doit être positif');
  }

  const stayCap = round2(Number(finalPrice || 0) + Number(touristTaxTotal || 0));
  if (round2(Number(alreadyRefundedTotal || 0) + totalTtc) > stayCap) {
    return invalid(
      'REFUND_EXCEEDS_STAY',
      `Le total remboursé dépasserait le montant du séjour (${stayCap.toFixed(2)} €)`,
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

/**
 * Rule 48 — on a cancelled stay, each line is given back first from the collected money no cancellation
 * requalified (it keeps its bucket and VAT: the sale is reversed), then from the indemnity (bucket `indemnity`,
 * 0 %). The indemnity part of a sold line never exceeds what the cancellation requalified on it.
 */
function splitOnIndemnity(lines, byKey, budget) {
  let saleLeft = Math.round(budget.saleLeftTtc * 100);
  let indemnityLeft = Math.round(budget.indemnityLeftTtc * 100);
  const saleRoom = {};
  const indemnityRoom = {};
  for (const [key, line] of byKey) {
    indemnityRoom[key] = Math.round(Number(line.indemnityTtc || 0) * 100);
    saleRoom[key] = Math.round(line.refundableTtc * 100) - indemnityRoom[key];
  }
  const out = [];
  for (const line of lines) {
    const cents = Math.round(line.amountTtc * 100);
    const key = line.lineKey;
    const sale = Math.min(cents, saleLeft, key ? Math.max(0, saleRoom[key]) : cents);
    const fromIndemnity = cents - sale;
    if (fromIndemnity > indemnityLeft || (key && fromIndemnity > indemnityRoom[key])) {
      const billed = key ? byKey.get(key) : null;
      return billed
        ? invalid('REFUND_EXCEEDS_LINE', `« ${billed.label} » : le remboursement dépasse le montant encaissé (${billed.refundableTtc.toFixed(2)} €)`, 409)
        : invalid('REFUND_EXCEEDS_COLLECTED', `Le remboursement dépasse le montant encaissé (${budget.collectedTtc.toFixed(2)} €)`, 409);
    }
    saleLeft -= sale;
    indemnityLeft -= fromIndemnity;
    if (key) {
      saleRoom[key] -= sale;
      indemnityRoom[key] -= fromIndemnity;
    }
    const part = (amountCents) => ({
      ...line,
      amountTtc: amountCents / 100,
      quantity: line.unitPrice ? Math.round((amountCents / 100 / line.unitPrice) * 10000) / 10000 : line.quantity,
    });
    if (sale > 0) out.push(part(sale));
    if (fromIndemnity > 0) out.push({ ...part(fromIndemnity), bucket: INDEMNITY_BUCKET, vatRate: 0 });
  }
  return { lines: out };
}

module.exports = {
  REFUND_METHODS,
  SELECTABLE_REFUND_METHODS,
  RETAINED_DEPOSIT_METHOD,
  REFUND_BUCKETS,
  INDEMNITY_BUCKET,
  OFF_BOOKS_METHOD,
  ACCOMMODATION_KEY,
  TOURIST_TAX_KEY,
  isOffBooks,
  isRetainedDeposit,
  isIndemnityLine,
  cancelledRefundBudget,
  billedLineKey,
  refundedByKey,
  refundedTouristTax,
  refundsTotal,
  buildRefundableLines,
  splitHtVat,
  validateRefundPayload,
  round2,
};
