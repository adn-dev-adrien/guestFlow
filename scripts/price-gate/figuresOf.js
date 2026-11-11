/**
 * The figure set of one stay (specs/pricing-components.md §3 rules 68 and 70).
 *
 * Pure: `figuresOf({ row, quote, fiche, cancellation, installments })` turns what the current code computed
 * for a stay into one flat object `{ 'path.of.the.figure': value }` of integers (cents), booleans, strings
 * (dates, keys) and `null`. Flat on purpose: the comparison names the exact figure that moved
 * (`{reservationId, field, expected, actual}`), and an allowlist entry matches one field.
 *
 * Inputs, all read from the application as it is today:
 *   row           the stored reservation row (`SELECT * FROM reservations`)
 *   quote         `quoteStoredReservation(db, row)` — the engine's quote of the stored stay
 *   fiche         { remainingDue, paymentComplete, collectedTtc, refundTotals } from the fiche payload
 *   cancellation  `previewFor(id)` of the cancellation controller: the figures, or `{ error }` when refused
 *   installments  `installmentsModel.listFor(id)`
 *   refunds       { register, stored, live, journal } — the refund side (rule 72): the refund register of the stay
 *                 (refundable lines, collected TTC, refunds made), the trop-perçu stored on the fiche and the live
 *                 one with their lines, and the accounting-export entries of its refunds
 *
 * This file never reads the code it guards: it only reshapes numbers. Money is converted once, with the
 * same `Math.round(x * 100)` for every figure, so a figure differs only when the amount does.
 */

const cents = (value) => (value == null || value === '' ? null : Math.round(Number(value) * 100));
// Quantities and billed units may be decimal (typed counts): thousandths keep them exact integers.
const milli = (value) => (value == null || value === '' ? null : Math.round(Number(value) * 1000));
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
    out[`line.${key}.quantity`] = milli(line.quantity);
    out[`line.${key}.billedUnits`] = milli(line.billedUnits);
    out[`line.${key}.unitPrice`] = cents(line.unitPrice);
    out[`line.${key}.total`] = cents(line.totalPrice);
    out[`line.${key}.offered`] = flag(line.offered);
    out[`line.${key}.inComplement`] = flag(line.inComplement);
    out[`line.${key}.acompteContrib`] = cents(line.acompteContribTtc);
    out[`line.${key}.soldeContrib`] = cents(line.soldeContribTtc);
  }
}

function putNights(out, quote) {
  out.nights = quote.nights == null ? null : Number(quote.nights);
  for (const night of quote.nightlyBreakdown || []) out[`night.${night.date}`] = cents(night.price);
}

function putTotals(out, quote) {
  out['total.accommodation'] = cents(quote.totalPrice);
  out['total.options'] = cents(quote.optionsTotal);
  out['total.resources'] = cents(quote.resourcesTotal);
  out['total.subtotal'] = cents(quote.subtotal);
  out['total.final'] = cents(quote.finalPrice);
  out['total.stay'] = cents(quote.totalStayPrice);
  out['total.net'] = cents(quote.sejourNetTotal);
  out['total.preArrival'] = cents(quote.preArrivalAmount);
  out['discount.percent'] = cents(quote.discountPercent);
  out['discount.amount'] = cents(quote.discountAmount);
  out['extraGuest.surcharge'] = cents(quote.extraGuestSurcharge);
  out['extraGuest.inBrut'] = cents(quote.extraGuestInBrutSurcharge);
  out['extraGuest.complement'] = cents(quote.extraGuestComplementSurcharge);
  out['extraGuest.count'] = quote.extraGuestCount == null ? null : Number(quote.extraGuestCount);
}

function putTouristTax(out, quote) {
  out['touristTax.total'] = cents(quote.touristTaxTotal);
  out['touristTax.originalTotal'] = cents(quote.touristTaxOriginalTotal);
  out['touristTax.rate'] = cents(quote.touristTaxRate);
  out['touristTax.baseHt'] = cents(quote.touristTaxBaseHt);
  out['touristTax.perOccupantNightHt'] = cents(quote.touristTaxPerOccupantNightPriceHt);
  out['touristTax.occupants'] = quote.touristTaxOccupantsCount == null ? null : Number(quote.touristTaxOccupantsCount);
  out['touristTax.inComplement'] = flag(quote.touristTaxInComplement);
  out['touristTax.frozen'] = flag(quote.touristTaxFrozen);
  out['touristTax.withheldByPlatform'] = cents(quote.platformTouristTaxWithheld);
}

function putVat(out, quote) {
  for (const [bucket, rate, net, vat] of [
    ['accommodation', quote.vatPercentageAccommodation, quote.accommodationNetPrice, quote.accommodationVatAmount],
    ['options', quote.vatPercentageOptions, quote.optionsNetPrice, quote.optionsVatAmount],
    ['resources', quote.vatPercentageResources, quote.resourcesNetPrice, quote.resourcesVatAmount],
  ]) {
    out[`vat.${bucket}.rate`] = cents(rate);
    out[`vat.${bucket}.net`] = cents(net);
    out[`vat.${bucket}.vat`] = cents(vat);
  }
  out['vat.total.net'] = cents(quote.totalNetPrice);
  out['vat.total.vat'] = cents(quote.totalVatAmount);
  out['vat.regime'] = text(quote.vatRegime && quote.vatRegime.regime);
  out['vat.regimeRate'] = quote.vatRegime ? cents(quote.vatRegime.rate) : null;
}

function putSchedule(out, row, quote, installments) {
  out['schedule.deposit'] = cents(quote.depositAmount);
  out['schedule.depositDue'] = text(quote.depositDueDate);
  out['schedule.balance'] = cents(quote.balanceAmount);
  out['schedule.balanceDue'] = text(quote.balanceDueDate);
  out['schedule.complement'] = cents(quote.complementAmount);
  out['schedule.complementAuto'] = cents(quote.complementAmountAuto);
  out['schedule.endOfStayComplement'] = cents(quote.endOfStayComplementTotal);
  out['schedule.overCollected'] = cents(quote.overCollectedTtc);
  for (const installment of installments || []) {
    const n = `installment.${installment.number}`;
    out[`${n}.amount`] = installment.amountCents == null ? null : Number(installment.amountCents);
    out[`${n}.due`] = text(installment.dueDate);
    out[`${n}.paid`] = flag(installment.paid);
    out[`${n}.paidDate`] = text(installment.paidDate);
  }
  for (const column of ['totalPrice', 'finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount',
    'touristTaxTotal', 'installmentsPaidAmount', 'installmentsUnpaidAmount', 'installmentsTarget']) {
    out[`stored.${column}`] = cents(row[column]);
  }
  for (const column of ['depositDueDate', 'balanceDueDate']) out[`stored.${column}`] = text(row[column]);
}

function putPaid(out, row, fiche) {
  for (const column of ['depositPaid', 'balancePaid', 'complementPaid', 'endOfStayComplementPaid']) out[`paid.${column}`] = flag(row[column]);
  out['paid.collected'] = cents(fiche && fiche.collectedTtc);
  out['paid.remainingDue'] = cents(fiche && fiche.remainingDue);
  out['paid.complete'] = fiche ? flag(fiche.paymentComplete) : null;
  out['paid.refundsBook'] = cents(fiche && fiche.refundTotals && fiche.refundTotals.book);
  out['paid.refundsCash'] = cents(fiche && fiche.refundTotals && fiche.refundTotals.withCash);
}

function putCancellation(out, row, cancellation) {
  if (cancellation && cancellation.error) {
    out['cancel.refusal'] = text(cancellation.error);
  } else if (cancellation) {
    out['cancel.refusal'] = null;
    out['cancel.indemnity'] = cents(cancellation.indemnityAmount);
    out['cancel.retainedDeposit'] = cents(cancellation.retainedDepositAmount);
    out['cancel.kept'] = cents(cancellation.keptFromGuest);
    out['cancel.writtenOffBalance'] = cents(cancellation.writtenOffBalance);
    out['cancel.reason'] = text(cancellation.cancellationReason);
  }
  // The commissions a platform withheld on the acompte and the solde that reached the books (rule 70): what a
  // cancellation of the stay reverses, read from the stored columns the way the cancellation reads them.
  const booked = (paid, cash) => flag(row[paid]) && !flag(row[cash]);
  out['cancel.withheld.deposit'] = booked('depositPaid', 'depositPaidCash') ? Math.max(0, cents(row.acompteCommissionAmount) || 0) : 0;
  out['cancel.withheld.solde'] = booked('balancePaid', 'balancePaidCash') ? Math.max(0, cents(row.platformCommissionAmount) || 0) : 0;
}

function putPlatform(out, row, quote) {
  out['platform.sale'] = flag(quote.platformSale);
  out['platform.takesDeposit'] = flag(quote.platformTakesDeposit);
  out['platform.gross'] = cents(row.platformGrossAmount);
  out['platform.payout'] = cents(row.platformPayoutAmount);
  out['platform.withheldTax'] = cents(row.platformTouristTaxAmount);
  out['platform.penalty'] = cents(row.platformPenaltyAmount);
  out['platform.commission.acompte'] = cents(quote.acompteCommissionAmount);
  out['platform.commission.solde'] = cents(quote.platformCommissionAmount);
  out['platform.commission.total'] = cents(quote.totalPlatformCommission);
  out['platform.netReceived'] = cents(quote.platformNetReceivedAmount);
  out['platform.stored.commission.acompte'] = cents(row.acompteCommissionAmount);
  out['platform.stored.commission.solde'] = cents(row.platformCommissionAmount);
}

const REFUND_LINE_FIELDS = ['refundableTtc', 'indemnityTtc', 'cashTtc', 'collectedTtc', 'billedTtc', 'unitPrice', 'maxTtc', 'vatRate'];

function putOverpayment(out, name, overpayment) {
  if (!overpayment) { out[`${name}.ttc`] = null; return; }
  out[`${name}.ttc`] = cents(overpayment.overpaymentTtc);
  out[`${name}.method`] = text(overpayment.overpaymentMethod);
  (overpayment.overpaymentLines || []).forEach((line, i) => {
    const key = `${name}.line.${i}`;
    out[`${key}.bucket`] = text(line.bucket);
    for (const field of ['amountTtc', 'collectedTtc', 'dueTtc']) if (line[field] != null) out[`${key}.${field}`] = cents(line[field]);
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
    out['refund.collected'] = cents(register.collectedTtc);
    out['refund.totals.book'] = cents(register.refundTotals && register.refundTotals.book);
    out['refund.totals.withCash'] = cents(register.refundTotals && register.refundTotals.withCash);
    for (const line of register.refundableLines || []) {
      for (const field of REFUND_LINE_FIELDS) if (line[field] != null) out[`refund.line.${named(line.key)}.${field}`] = cents(line[field]);
      out[`refund.line.${named(line.key)}.bucket`] = text(line.bucket);
    }
    for (const r of register.refunds || []) {
      const key = `refund.made.${r.id}`;
      out[`${key}.method`] = text(r.method);
      out[`${key}.date`] = text(r.refundDate);
      out[`${key}.total`] = cents(r.totalTtc);
      out[`${key}.afterCancellation`] = flag(r.afterCancellation);
      (r.lines || []).forEach((l, i) => {
        out[`${key}.line.${i}.key`] = text(named(l.lineKey));
        out[`${key}.line.${i}.bucket`] = text(l.bucket);
        out[`${key}.line.${i}.amount`] = cents(l.amountTtc);
        out[`${key}.line.${i}.vatRate`] = cents(l.vatRate);
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
      out[`${key}.${i}.debit`] = cents(l.debit);
      out[`${key}.${i}.credit`] = cents(l.credit);
    });
  }
}

function figuresOf({ row, quote, fiche = null, cancellation = null, installments = [], refunds = null }) {
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
  putCancellation(out, row, cancellation);
  putPlatform(out, row, quote);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

module.exports = { figuresOf };
