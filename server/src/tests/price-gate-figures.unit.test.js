// specs/pricing-components.md §3 rules 68 and 70 — `scripts/price-gate/figuresOf.js`: the figure set of one stay from its
// quote and stored row, flat, every number exactly as the code returned it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { figuresOf, figuresOfResourceBooking } = require('../../../scripts/price-gate/figuresOf');

const quote = (over = {}) => ({
  nights: 2,
  nightlyBreakdown: [{ date: 'n1', price: 100.1 }, { date: 'n2', price: 99.9 }],
  optionLines: [{ optionId: 7, quantity: 1, billedUnits: 1.5, unitPrice: 80, totalPrice: 80, offered: false, inComplement: 1, acompteContribTtc: null, soldeContribTtc: 80 },
    { customOptionId: 49, quantity: 1, billedUnits: 1, unitPrice: 25, totalPrice: 25, offered: 1, inComplement: 0 }],
  resourceLines: [{ resourceId: 3, quantity: 2, billedUnits: 2, unitPrice: 10, totalPrice: 20 }],
  totalPrice: 200, optionsTotal: 105, resourcesTotal: 20, subtotal: 325, discountPercent: 10, discountAmount: 32.5, finalPrice: 292.5,
  totalStayPrice: 300, sejourNetTotal: 270, preArrivalAmount: 292.5, extraGuestSurcharge: 12, extraGuestInBrutSurcharge: 4, extraGuestComplementSurcharge: 8,
  extraGuestCount: 1,
  touristTaxTotal: 7.5, touristTaxOriginalTotal: 8, touristTaxRate: 1.5, touristTaxBaseHt: 100, touristTaxPerOccupantNightPriceHt: 12.5, touristTaxOccupantsCount: 5,
  touristTaxInComplement: true, touristTaxFrozen: false, platformTouristTaxWithheld: null,
  vatPercentageAccommodation: 10, vatPercentageOptions: 20, vatPercentageResources: 20,
  accommodationNetPrice: 181.82, accommodationVatAmount: 18.18, optionsNetPrice: 87.5, optionsVatAmount: 17.5, resourcesNetPrice: 16.67, resourcesVatAmount: 3.33,
  totalNetPrice: 285.99, totalVatAmount: 39.01, vatRegime: { regime: 'registered', rate: 10 },
  depositAmount: 87.75, depositDueDate: 'd1', balanceAmount: 204.75, balanceDueDate: 'd2', complementAmount: 30, complementAmountAuto: 30,
  endOfStayComplementTotal: 0, overCollectedTtc: 0,
  platformSale: true, platformTakesDeposit: false, acompteCommissionAmount: 0, platformCommissionAmount: 40.25, totalPlatformCommission: 40.25, platformNetReceivedAmount: 252.25,
  ...over,
});
const row = (over = {}) => ({
  kind: 'reservation', platform: 'Booking', startDate: 's', endDate: 'e', totalPrice: 200, finalPrice: 292.5, depositAmount: 87.75, balanceAmount: 204.75,
  depositPaid: 1, balancePaid: 0, depositPaidCash: 0, balancePaidCash: 0, platformGrossAmount: 330, platformPayoutAmount: 250, platformTouristTaxAmount: 7.5,
  platformPenaltyAmount: 12.34, acompteCommissionAmount: 3.2, platformCommissionAmount: 40.25, ...over,
});

test('rule 68: every figure is the number the code returned, a boolean, a string or null — never rounded', () => {
  const figures = figuresOf({ row: row(), quote: quote(), fiche: { remainingDue: 204.75, paymentComplete: false, collectedTtc: 87.75, refundTotals: { book: 0, withCash: 1.1 } },
    cancellation: { ok: true, indemnityAmount: 87.75, retainedDepositAmount: 87.75, keptFromGuest: 87.75, writtenOffBalance: 204.75, cancellationReason: 'manual' },
    installments: [{ number: 1, dueDate: 'i1', amountCents: 5000, paid: 1, paidDate: 'p1' }] });
  for (const [key, value] of Object.entries(figures)) {
    assert.ok(value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number', `${key} = ${value}`);
  }
  assert.equal(figures['night.n1'], 100.1);
  assert.equal(figures['night.n2'], 99.9);
  assert.equal(figures['total.final'], 292.5);
  assert.equal(figures['discount.percent'], 10);
  assert.equal(figures['vat.accommodation.rate'], 10);
  assert.equal(figures['vat.accommodation.vat'], 18.18);
  assert.equal(figures['vat.regime'], 'registered');
  assert.equal(figures['touristTax.total'], 7.5);
  assert.equal(figures['schedule.deposit'], 87.75);
  assert.equal(figures['schedule.balanceDue'], 'd2');
  assert.equal(figures['installment.1.amount'], 5000);
  assert.equal(figures['installment.1.paid'], true);
  assert.equal(figures['paid.collected'], 87.75);
  assert.equal(figures['paid.remainingDue'], 204.75);
  assert.equal(figures['paid.refundsCash'], 1.1);
  assert.equal(figures['cancel.indemnity'], 87.75);
  assert.equal(figures['cancel.refusal'], null);
});

test('rule 68: no rounding slack — 12.345 and 12.35 are two figures, a drift under a cent is seen', () => {
  const a = figuresOf({ row: row(), quote: quote({ finalPrice: 12.345, discountAmount: 0.1 + 0.2 }) });
  const b = figuresOf({ row: row(), quote: quote({ finalPrice: 12.35, discountAmount: 0.3 }) });
  assert.equal(a['total.final'], 12.345);
  assert.equal(b['total.final'], 12.35);
  assert.notEqual(a['total.final'], b['total.final']);
  assert.notEqual(a['discount.amount'], b['discount.amount'], '0.1 + 0.2 is not 0.3 and the gate says so');
  assert.equal(figuresOf({ row: row(), quote: quote({ extraGuestSurcharge: 0.004 }) })['extraGuest.surcharge'], 0.004);
  assert.equal(figuresOf({ row: row(), quote: quote({ optionLines: [{ optionId: 7, quantity: 1.0004, billedUnits: 2.2504 }] }) })['line.option:7.quantity'], 1.0004);
});

test('rule 68: a value JSON cannot carry is written as its name, -0 as 0, an absent value as null', () => {
  const figures = figuresOf({ row: row(), quote: quote({ totalPrice: NaN, optionsTotal: Infinity, resourcesTotal: -Infinity, subtotal: -0, discountPercent: undefined, discountAmount: '' }) });
  assert.deepEqual([figures['total.accommodation'], figures['total.options'], figures['total.resources']], ['NaN', 'Infinity', '-Infinity']);
  assert.ok(Object.is(figures['total.subtotal'], 0));
  assert.deepEqual([figures['discount.percent'], figures['discount.amount']], [null, null]);
  assert.deepEqual(JSON.parse(JSON.stringify(figures))['total.accommodation'], 'NaN');
});

test('rule 68: every extra line is keyed by its identity and carries quantity, total, offered and routing', () => {
  const figures = figuresOf({ row: row(), quote: quote() });
  assert.equal(figures['line.option:7.total'], 80);
  assert.equal(figures['line.option:7.quantity'], 1);
  assert.equal(figures['line.option:7.billedUnits'], 1.5);
  assert.equal(figures['line.option:7.inComplement'], true);
  assert.equal(figures['line.option:7.soldeContrib'], 80);
  assert.equal(figures['line.option:7.acompteContrib'], null);
  assert.equal(figures['line.custom:49.offered'], true);
  assert.equal(figures['line.resource:3.total'], 20);
});

test('rule 68: two lines on one identity are both kept, the second suffixed', () => {
  const figures = figuresOf({ row: row(), quote: quote({ optionLines: [{ optionId: 7, totalPrice: 1 }, { optionId: 7, totalPrice: 2 }] }) });
  assert.equal(figures['line.option:7.total'], 1);
  assert.equal(figures['line.option:7#2.total'], 2);
});

test('rule 70: the platform figures — commissions, net received, the stored inputs, the withheld commissions the code reports', () => {
  const figures = figuresOf({ row: row({ balancePaid: 1 }), quote: quote(), withheld: { total: 43.45, buckets: { accommodation: 40.25, options: 3.2 } } });
  assert.equal(figures['platform.sale'], true);
  assert.equal(figures['platform.commission.solde'], 40.25);
  assert.equal(figures['platform.commission.total'], 40.25);
  assert.equal(figures['platform.netReceived'], 252.25);
  assert.equal(figures['input.platform.payout'], 250);
  assert.equal(figures['input.platform.gross'], 330);
  assert.equal(figures['input.platform.withheldTax'], 7.5);
  assert.equal(figures['input.platform.penalty'], 12.34);
  assert.equal(figures['platform.stored.commission.acompte'], 3.2);
  assert.equal(figures['cancel.withheld.total'], 43.45);
  assert.equal(figures['cancel.withheld.bucket.accommodation'], 40.25);
  assert.equal(figures['cancel.withheld.bucket.options'], 3.2);
  assert.ok(!Object.keys(figures).some((k) => k.startsWith('platform.gross') || k.startsWith('platform.payout') || k.startsWith('platform.penalty')), 'the stored inputs are named as inputs');
});

test('rule 70: the withheld commissions are what the code reports — the columns of the row alone say nothing', () => {
  const none = figuresOf({ row: row({ depositPaid: 1, balancePaid: 1 }), quote: quote(), withheld: { total: 0, buckets: {} } });
  assert.equal(none['cancel.withheld.total'], 0);
  assert.ok(!Object.keys(none).some((k) => k.startsWith('cancel.withheld.bucket')));
  const refused = figuresOf({ row: row({ depositPaid: 1, balancePaid: 1 }), quote: quote(), withheld: null });
  assert.ok(!Object.keys(refused).some((k) => k.startsWith('cancel.withheld')), 'a refused cancellation reports none, the row is not read');
});

test('rule 68: the date-dependent figures — overdue flags and amount, oldest due date, the operational collection — are figures', () => {
  const figures = figuresOf({
    row: row(), quote: quote(),
    paymentStatus: { remainingDue: 204.75, paymentComplete: false, depositOverdue: true, balanceOverdue: false, overdueAmount: 87.75, oldestDueDate: 'd1', isOverdue: true },
    fiche: { remainingDue: 1, paymentComplete: false, collectedTtc: 2, refundTotals: { book: 0, withCash: 0 }, operationalCollection: { arrival: { alert: 'warn', amountDue: 12.5, parts: [{ key: 'deposit', state: 'pending' }] }, platformSettled: false, platform: null } },
  });
  assert.equal(figures['status.depositOverdue'], true);
  assert.equal(figures['status.overdueAmount'], 87.75);
  assert.equal(figures['status.oldestDueDate'], 'd1');
  assert.equal(figures['collection.arrival.amountDue'], 12.5);
  assert.equal(figures['collection.arrival.alert'], 'warn');
  assert.equal(figures['collection.arrival.parts.0.state'], 'pending');
  assert.equal(figures['collection.platformSettled'], false);
  assert.ok(!('collection.platform' in figures) && !Object.keys(figuresOf({ row: row(), quote: quote() })).some((k) => k.startsWith('status.')));
});

test('rule 68: a standalone resource booking — stored price, the breakdown the code computes, the sale row the journal reads', () => {
  const figures = figuresOfResourceBooking({
    row: { resourceId: 3, propertyId: null, reservationId: null, date: 'd', totalPrice: 78.75, offeredMinutes: 0, paid: 1, paidVatRate: 20, paidAt: 'p', paymentRecordedAt: 'r', paymentTenders: '[]' },
    breakdown: { total: 78.75, vat: { rate: 20, amount: 13.125, net: 65.625 }, bands: [{ band: 'day', amount: 78.75 }] },
    sale: { key: 'resource-booking:1', totalCents: 7875, booksCents: 5000, cardCents: 5000, vatRate: 20, date: 'p' },
  });
  assert.equal(figures['stored.totalPrice'], 78.75);
  assert.equal(figures['stored.paid'], true);
  assert.equal(figures['breakdown.vat.amount'], 13.125);
  assert.equal(figures['breakdown.bands.0.amount'], 78.75);
  assert.equal(figures['sale.booksCents'], 5000);
  assert.deepEqual(Object.keys(figures), [...Object.keys(figures)].sort());
  assert.ok(!Object.keys(figuresOfResourceBooking({ row: { totalPrice: 1 } })).some((k) => k.startsWith('sale.')));
});

test('rule 68: a refused cancellation is a figure, a stay with no quote is an error figure', () => {
  assert.equal(figuresOf({ row: row(), quote: quote(), cancellation: { error: 'PLATFORM_RESERVATION', status: 403 } })['cancel.refusal'], 'PLATFORM_RESERVATION');
  const broken = figuresOf({ row: row({ kind: 'devis' }), quote: { error: 'PROPERTY_NOT_FOUND' } });
  assert.equal(broken['quote.error'], 'PROPERTY_NOT_FOUND');
  assert.equal(broken.kind, 'devis');
  assert.equal(figuresOf({ row: row(), quote: null })['quote.error'], 'no quote');
});

test('rule 68: what was sold during the stay, what its notes collected and the complement split are figures', () => {
  const figures = figuresOf({ row: row(), quote: quote({ midStayExtrasTotal: 47.99, midStaySettledTotal: 43.34, midStayRemainingTotal: 4.65, complementRoutedAmount: 41.2, complementCollectedExcessTtc: 0.01, complementSplit: { arrival: 0, duringStay: 43.34, endOfStay: 4.65 } }) });
  assert.deepEqual([figures['midStay.extrasTotal'], figures['midStay.settledTotal'], figures['midStay.remainingTotal']], [47.99, 43.34, 4.65]);
  assert.deepEqual([figures['complementSplit.arrival'], figures['complementSplit.duringStay'], figures['complementSplit.endOfStay']], [0, 43.34, 4.65]);
  assert.deepEqual([figures['schedule.complementRouted'], figures['schedule.complementCollectedExcess']], [41.2, 0.01]);
  assert.equal(figuresOf({ row: row(), quote: quote() })['complementSplit.duringStay'], null);
});

test('rule 68: the keys come out sorted and the result does not depend on the order of the lines', () => {
  const a = figuresOf({ row: row(), quote: quote() });
  const b = figuresOf({ row: row(), quote: quote({ nightlyBreakdown: [...quote().nightlyBreakdown].reverse() }) });
  assert.deepEqual(Object.keys(a), [...Object.keys(a)].sort());
  assert.deepEqual(a, b);
});

test('rule 72: the refund figures are exact, a custom line is numbered never named, a stay without a register carries none', () => {
  const refunds = {
    register: {
      collectedTtc: 274.5,
      refundTotals: { book: 10, withCash: 12.5 },
      refundableLines: [
        { key: 'accommodation', bucket: 'accommodation', refundableTtc: 100.1, indemnityTtc: 20, cashTtc: 0 },
        { key: 'custom:some private label', bucket: 'options', refundableTtc: 30, billedTtc: 30 },
      ],
      refunds: [{ id: 4, method: 'transfer', refundDate: 'd1', totalTtc: 10, afterCancellation: 1, lines: [{ lineKey: 'custom:some private label', bucket: 'options', amountTtc: 10, vatRate: 10 }] }],
    },
    stored: { overpaymentTtc: 5.25, overpaymentMethod: 'internal', overpaymentLines: [{ bucket: 'options', label: 'x', amountTtc: 5.25, collectedTtc: 30, dueTtc: 24.75 }] },
    live: null,
    journal: [{ refundId: 4, date: 'd1', lines: [{ compte: '70600000', debit: 9.09, credit: 0 }, { compte: 'CSOMENAME', debit: 0, credit: 9.09 }] }],
  };
  const figures = figuresOf({ row: row(), quote: { error: 'x' }, refunds });
  assert.equal(figures['refund.collected'], 274.5);
  assert.equal(figures['refund.line.accommodation.refundableTtc'], 100.1);
  assert.equal(figures['refund.line.custom#1.refundableTtc'], 30);
  assert.equal(figures['refund.made.4.line.0.key'], 'custom#1');
  assert.equal(figures['overpayment.stored.ttc'], 5.25);
  assert.equal(figures['overpayment.stored.line.0.dueTtc'], 24.75);
  assert.equal(figures['overpayment.live.ttc'], null);
  assert.equal(figures['refund.journal.4.0.debit'], 9.09);
  assert.equal(figures['refund.journal.4.1.account'], 'client');
  assert.ok(!Object.keys(figures).concat(Object.values(figures).filter((v) => typeof v === 'string')).some((k) => /private/.test(k)));
  assert.ok(!Object.keys(figuresOf({ row: row(), quote: { error: 'x' }, refunds: null })).some((k) => k.startsWith('refund.')));
});
