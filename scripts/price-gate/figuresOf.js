/**
 * The figure set of one stay (specs/pricing-components.md §3 rules 68 and 70).
 *
 * Pure: `figuresOf({ row, quote, fiche, cancellation, installments })` turns what the current code computed
 * for a stay into one flat object `{ 'path.of.the.figure': value }` of numbers read EXACTLY as the code produced them
 * (no rounding here: 12.345 and 12.35 are two figures), booleans, strings (dates, keys) and `null`. Flat on purpose: the comparison names the exact figure that moved
 * (`{reservationId, field, expected, actual}`), and an allowlist entry matches one field.
 *
 * Inputs, all read from the application as it is today:
 *   row           the stored reservation row (`SELECT * FROM reservations`)
 *   quote         `quoteStoredReservation(db, row)` — the engine's quote of the stored stay
 *   fiche         { remainingDue, paymentComplete, collectedTtc, refundTotals, operationalCollection } from the fiche payload
 *   cancellation  `previewFor(id)` of the cancellation controller: the figures, or `{ error }` when refused
 *   withheld      the commission lines (`commission`) of the requalification the code builds when the stay is
 *                 cancelled now: `{ total, buckets: { [bucket]: amount } }`, or null when the cancellation is refused
 *   paymentStatus `computePaymentStatus(row, today)`: overdue flags and amount, oldest due date (date-dependent)
 *   splits        the collected splits the accounting reads: complement split, per-line data, the acompte's and the
 *                 solde's stored-money buckets (`splits.*`)
 *   installments  `installmentsModel.listFor(id)`
 *   refunds       { register, stored, live, journal } — the refund side (rule 72): the refund register of the stay
 *                 (refundable lines, collected TTC, refunds made), the trop-perçu stored on the fiche and the live
 *                 one with their lines, and the accounting-export entries of its refunds
 *
 * This file never reads the code it guards: it only reshapes numbers. A number is written as the code returned it
 * (`exact`): a gate that rounded to the cent would let a drift of a fraction of a cent through, and the cent that
 * the next rounding turns it into would be the first the gate sees. A value JSON cannot carry (NaN, Infinity) is
 * written as its name, and -0 as 0 (JSON writes both the same way, so the comparison could not tell them apart).
 */

function exact(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  return n === 0 ? 0 : n;
}
const flag = (value) => Number(value || 0) === 1 || value === true;
const text = (value) => (value == null ? null : String(value));

function lineKey(line, kind) {
  if (line.customOptionId != null) return `custom:${line.customOptionId}`;
  if (kind === 'resource') return `resource:${line.resourceId}`;
  return `option:${line.optionId}`;
}

function putLines(out, lines, kind) {
  const counts = {};
  for (const line of lines || []) {
    const base = lineKey(line, kind);
    counts[base] = (counts[base] || 0) + 1;
    const key = counts[base] > 1 ? `${base}#${counts[base]}` : base;
    out[`line.${key}.quantity`] = exact(line.quantity);
    out[`line.${key}.billedUnits`] = exact(line.billedUnits);
    out[`line.${key}.unitPrice`] = exact(line.unitPrice);
    out[`line.${key}.total`] = exact(line.totalPrice);
    out[`line.${key}.offered`] = flag(line.offered);
    out[`line.${key}.inComplement`] = flag(line.inComplement);
    out[`line.${key}.acompteContrib`] = exact(line.acompteContribTtc);
    out[`line.${key}.soldeContrib`] = exact(line.soldeContribTtc);
  }
}

function putNights(out, quote) {
  out.nights = quote.nights == null ? null : Number(quote.nights);
  for (const night of quote.nightlyBreakdown || []) out[`night.${night.date}`] = exact(night.price);
}

function putTotals(out, quote) {
  out['total.accommodation'] = exact(quote.totalPrice);
  out['total.options'] = exact(quote.optionsTotal);
  out['total.resources'] = exact(quote.resourcesTotal);
  out['total.subtotal'] = exact(quote.subtotal);
  out['total.final'] = exact(quote.finalPrice);
  out['total.stay'] = exact(quote.totalStayPrice);
  out['total.net'] = exact(quote.sejourNetTotal);
  out['total.preArrival'] = exact(quote.preArrivalAmount);
  out['discount.percent'] = exact(quote.discountPercent);
  out['discount.amount'] = exact(quote.discountAmount);
  out['extraGuest.surcharge'] = exact(quote.extraGuestSurcharge);
  out['extraGuest.inBrut'] = exact(quote.extraGuestInBrutSurcharge);
  out['extraGuest.complement'] = exact(quote.extraGuestComplementSurcharge);
  out['extraGuest.count'] = quote.extraGuestCount == null ? null : Number(quote.extraGuestCount);
}

function putTouristTax(out, quote) {
  out['touristTax.total'] = exact(quote.touristTaxTotal);
  out['touristTax.originalTotal'] = exact(quote.touristTaxOriginalTotal);
  out['touristTax.rate'] = exact(quote.touristTaxRate);
  out['touristTax.baseHt'] = exact(quote.touristTaxBaseHt);
  out['touristTax.perOccupantNightHt'] = exact(quote.touristTaxPerOccupantNightPriceHt);
  out['touristTax.occupants'] = quote.touristTaxOccupantsCount == null ? null : Number(quote.touristTaxOccupantsCount);
  out['touristTax.inComplement'] = flag(quote.touristTaxInComplement);
  out['touristTax.frozen'] = flag(quote.touristTaxFrozen);
  out['touristTax.withheldByPlatform'] = exact(quote.platformTouristTaxWithheld);
}

function putVat(out, quote) {
  for (const [bucket, rate, net, vat] of [
    ['accommodation', quote.vatPercentageAccommodation, quote.accommodationNetPrice, quote.accommodationVatAmount],
    ['options', quote.vatPercentageOptions, quote.optionsNetPrice, quote.optionsVatAmount],
    ['resources', quote.vatPercentageResources, quote.resourcesNetPrice, quote.resourcesVatAmount],
  ]) {
    out[`vat.${bucket}.rate`] = exact(rate);
    out[`vat.${bucket}.net`] = exact(net);
    out[`vat.${bucket}.vat`] = exact(vat);
  }
  out['vat.total.net'] = exact(quote.totalNetPrice);
  out['vat.total.vat'] = exact(quote.totalVatAmount);
  out['vat.regime'] = text(quote.vatRegime && quote.vatRegime.regime);
  out['vat.regimeRate'] = quote.vatRegime ? exact(quote.vatRegime.rate) : null;
}

function putSchedule(out, row, quote, installments) {
  out['schedule.deposit'] = exact(quote.depositAmount);
  out['schedule.depositDue'] = text(quote.depositDueDate);
  out['schedule.balance'] = exact(quote.balanceAmount);
  out['schedule.balanceDue'] = text(quote.balanceDueDate);
  out['schedule.complement'] = exact(quote.complementAmount);
  out['schedule.complementAuto'] = exact(quote.complementAmountAuto);
  out['schedule.endOfStayComplement'] = exact(quote.endOfStayComplementTotal);
  out['schedule.overCollected'] = exact(quote.overCollectedTtc);
  out['schedule.complementRouted'] = exact(quote.complementRoutedAmount);
  out['schedule.complementCollectedExcess'] = exact(quote.complementCollectedExcessTtc);
  // What was sold during the stay and what its notes already collected, and where the complement splits (arrival, stay, departure).
  out['midStay.extrasTotal'] = exact(quote.midStayExtrasTotal);
  out['midStay.settledTotal'] = exact(quote.midStaySettledTotal);
  out['midStay.remainingTotal'] = exact(quote.midStayRemainingTotal);
  const split = quote.complementSplit || {};
  for (const part of ['arrival', 'duringStay', 'endOfStay']) out[`complementSplit.${part}`] = exact(split[part]);
  for (const installment of installments || []) {
    const n = `installment.${installment.number}`;
    out[`${n}.amount`] = installment.amountCents == null ? null : Number(installment.amountCents);
    out[`${n}.due`] = text(installment.dueDate);
    out[`${n}.paid`] = flag(installment.paid);
    out[`${n}.paidDate`] = text(installment.paidDate);
  }
  for (const column of ['totalPrice', 'finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount',
    'touristTaxTotal', 'installmentsPaidAmount', 'installmentsUnpaidAmount', 'installmentsTarget']) {
    out[`stored.${column}`] = exact(row[column]);
  }
  for (const column of ['depositDueDate', 'balanceDueDate']) out[`stored.${column}`] = text(row[column]);
}

function putPaid(out, row, fiche) {
  for (const column of ['depositPaid', 'balancePaid', 'complementPaid', 'endOfStayComplementPaid']) out[`paid.${column}`] = flag(row[column]);
  out['paid.collected'] = exact(fiche && fiche.collectedTtc);
  out['paid.remainingDue'] = exact(fiche && fiche.remainingDue);
  out['paid.complete'] = fiche ? flag(fiche.paymentComplete) : null;
  out['paid.refundsBook'] = exact(fiche && fiche.refundTotals && fiche.refundTotals.book);
  out['paid.refundsCash'] = exact(fiche && fiche.refundTotals && fiche.refundTotals.withCash);
  putFlat(out, 'collection', fiche && fiche.operationalCollection);
}

// The day-dependent flags of `computePaymentStatus`: overdue acompte / solde, overdue amount, oldest due date.
function putPaymentStatus(out, status) {
  if (!status) return;
  for (const [key, value] of Object.entries(status)) out[`status.${key}`] = typeof value === 'number' ? exact(value) : (typeof value === 'boolean' ? value : text(value));
}

// A nested block (the fiche's operational collection) as flat figures: `<prefix>.<path>`, arrays by index.
function putFlat(out, prefix, value) {
  if (value == null) return;
  if (Array.isArray(value)) { value.forEach((item, i) => putFlat(out, `${prefix}.${i}`, item)); return; }
  if (typeof value === 'object') { for (const [key, inner] of Object.entries(value)) putFlat(out, `${prefix}.${key}`, inner); return; }
  out[prefix] = typeof value === 'number' ? exact(value) : (typeof value === 'boolean' ? value : text(value));
}

function putCancellation(out, cancellation, withheld) {
  if (cancellation && cancellation.error) {
    out['cancel.refusal'] = text(cancellation.error);
  } else if (cancellation) {
    out['cancel.refusal'] = null;
    out['cancel.indemnity'] = exact(cancellation.indemnityAmount);
    out['cancel.retainedDeposit'] = exact(cancellation.retainedDepositAmount);
    out['cancel.kept'] = exact(cancellation.keptFromGuest);
    out['cancel.writtenOffBalance'] = exact(cancellation.writtenOffBalance);
    out['cancel.reason'] = text(cancellation.cancellationReason);
  }
  // The commissions a platform withheld on the acompte and the solde (rule 70): the `commission` lines of the
  // requalification the application itself builds when the stay is cancelled now, per bucket — never recomputed here.
  if (withheld) {
    out['cancel.withheld.total'] = exact(withheld.total);
    for (const [bucket, amount] of Object.entries(withheld.buckets || {})) out[`cancel.withheld.bucket.${bucket}`] = exact(amount);
  }
}

function putPlatform(out, row, quote) {
  out['platform.sale'] = flag(quote.platformSale);
  out['platform.takesDeposit'] = flag(quote.platformTakesDeposit);
  out['input.platform.gross'] = exact(row.platformGrossAmount);
  out['input.platform.payout'] = exact(row.platformPayoutAmount);
  out['input.platform.withheldTax'] = exact(row.platformTouristTaxAmount);
  out['input.platform.penalty'] = exact(row.platformPenaltyAmount);
  out['platform.commission.acompte'] = exact(quote.acompteCommissionAmount);
  out['platform.commission.solde'] = exact(quote.platformCommissionAmount);
  out['platform.commission.total'] = exact(quote.totalPlatformCommission);
  out['platform.netReceived'] = exact(quote.platformNetReceivedAmount);
  out['platform.stored.commission.acompte'] = exact(row.acompteCommissionAmount);
  out['platform.stored.commission.solde'] = exact(row.platformCommissionAmount);
}

const REFUND_LINE_FIELDS = ['refundableTtc', 'indemnityTtc', 'cashTtc', 'collectedTtc', 'billedTtc', 'unitPrice', 'maxTtc', 'vatRate'];

function putOverpayment(out, name, overpayment) {
  if (!overpayment) { out[`${name}.ttc`] = null; return; }
  out[`${name}.ttc`] = exact(overpayment.overpaymentTtc);
  out[`${name}.method`] = text(overpayment.overpaymentMethod);
  (overpayment.overpaymentLines || []).forEach((line, i) => {
    const key = `${name}.line.${i}`;
    out[`${key}.bucket`] = text(line.bucket);
    for (const field of ['amountTtc', 'collectedTtc', 'dueTtc']) if (line[field] != null) out[`${key}.${field}`] = exact(line[field]);
  });
}

// A custom line is keyed by its label (`custom:<text>`): a figure name never carries it, the line is numbered in the
// order the stay meets it (the register first, then the refunds made), whatever the text.
function lineNamer() {
  const seen = new Map();
  return (key) => {
    if (key == null || !String(key).startsWith('custom:')) return key;
    if (!seen.has(key)) seen.set(key, `custom#${seen.size + 1}`);
    return seen.get(key);
  };
}

function putRefunds(out, refunds) {
  if (!refunds) return;
  const named = lineNamer();
  const { register, stored, live, journal } = refunds;
  if (register) {
    out['refund.collected'] = exact(register.collectedTtc);
    out['refund.totals.book'] = exact(register.refundTotals && register.refundTotals.book);
    out['refund.totals.withCash'] = exact(register.refundTotals && register.refundTotals.withCash);
    for (const line of register.refundableLines || []) {
      for (const field of REFUND_LINE_FIELDS) if (line[field] != null) out[`refund.line.${named(line.key)}.${field}`] = exact(line[field]);
      out[`refund.line.${named(line.key)}.bucket`] = text(line.bucket);
    }
    for (const r of register.refunds || []) {
      const key = `refund.made.${r.id}`;
      out[`${key}.method`] = text(r.method);
      out[`${key}.date`] = text(r.refundDate);
      out[`${key}.total`] = exact(r.totalTtc);
      out[`${key}.afterCancellation`] = flag(r.afterCancellation);
      (r.lines || []).forEach((l, i) => {
        out[`${key}.line.${i}.key`] = text(named(l.lineKey));
        out[`${key}.line.${i}.bucket`] = text(l.bucket);
        out[`${key}.line.${i}.amount`] = exact(l.amountTtc);
        out[`${key}.line.${i}.vatRate`] = exact(l.vatRate);
      });
    }
  }
  putOverpayment(out, 'overpayment.stored', stored);
  putOverpayment(out, 'overpayment.live', live);
  for (const entry of journal || []) {
    const key = `refund.journal.${entry.refundId}`;
    out[`${key}.date`] = text(entry.date);
    (entry.lines || []).forEach((l, i) => {
      // The client's auxiliary account is built from the guest's name: it is named « client », never copied.
      out[`${key}.${i}.account`] = /^\d/.test(String(l.compte)) ? text(l.compte) : 'client';
      out[`${key}.${i}.debit`] = exact(l.debit);
      out[`${key}.${i}.credit`] = exact(l.credit);
    });
  }
}

// The text a custom line carries (its label, the key built from it) is not a figure and differs between the capture and the
// anonymised copy: the line is numbered in the order the stay meets it, and its label is left out.
function withoutText(value) {
  const named = lineNamer();
  const walk = (inner) => {
    if (Array.isArray(inner)) return inner.map(walk);
    if (inner && typeof inner === 'object') {
      return Object.fromEntries(Object.entries(inner).filter(([key]) => !['label', 'description', 'title', 'name'].includes(key)).map(([key, v]) => [named(key), walk(v)]));
    }
    return typeof inner === 'string' ? named(inner) : inner;
  };
  return walk(value);
}

function figuresOf({ row, quote, fiche = null, cancellation = null, withheld = null, paymentStatus = null, splits = null, installments = [], refunds = null }) {
  const out = { kind: text(row.kind), platform: text(row.platform), startDate: text(row.startDate), endDate: text(row.endDate) };
  putRefunds(out, refunds);
  if (!quote || quote.error) {
    out['quote.error'] = text(quote && quote.error) || 'no quote';
    return out;
  }
  putNights(out, quote);
  putLines(out, quote.optionLines, 'option');
  putLines(out, quote.resourceLines, 'resource');
  putTotals(out, quote);
  putTouristTax(out, quote);
  putVat(out, quote);
  putSchedule(out, row, quote, installments);
  putPaid(out, row, fiche);
  putCancellation(out, cancellation, withheld);
  putPaymentStatus(out, paymentStatus);
  putFlat(out, 'splits', withoutText(splits));
  putPlatform(out, row, quote);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The figures of one standalone resource booking (`resource_bookings`, hourly-resources): its stored price columns, the
 * breakdown the application computes for it today (`breakdownOf`) and the sale row the journal reads (`standaloneSales`).
 */
function figuresOfResourceBooking({ row, breakdown = null, sale = null }) {
  const out = { resourceId: exact(row.resourceId), propertyId: exact(row.propertyId), reservationId: exact(row.reservationId), date: text(row.date) };
  for (const column of ['totalPrice', 'offeredMinutes', 'paidVatRate']) out[`stored.${column}`] = exact(row[column]);
  out['stored.paid'] = flag(row.paid);
  out['stored.paidAt'] = text(row.paidAt);
  out['stored.paymentRecordedAt'] = text(row.paymentRecordedAt);
  out['stored.paymentTenders'] = text(row.paymentTenders);
  putFlat(out, 'breakdown', breakdown);
  putFlat(out, 'sale', sale);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The platform price grid of a property (`propertiesModel.platformPrices`), flat: `grid.<path>`. */
function figuresOfPropertyGrid(grid) {
  const out = {};
  putFlat(out, 'grid', grid);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

module.exports = { figuresOf, figuresOfResourceBooking, figuresOfPropertyGrid };
