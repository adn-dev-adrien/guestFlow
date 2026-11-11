// specs/pricing-components.md §3 rules 68 and 70 — `scripts/price-gate/figuresOf.js`: the figure set of one stay from its
// quote and stored row, flat, in integer cents.
const test = require('node:test');
const assert = require('node:assert/strict');
const { figuresOf } = require('../../../scripts/price-gate/figuresOf');

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

test('rule 68: every figure is an integer in cents, a boolean, a string or null — never a float', () => {
  const figures = figuresOf({ row: row(), quote: quote(), fiche: { remainingDue: 204.75, paymentComplete: false, collectedTtc: 87.75, refundTotals: { book: 0, withCash: 1.1 } },
    cancellation: { ok: true, indemnityAmount: 87.75, retainedDepositAmount: 87.75, keptFromGuest: 87.75, writtenOffBalance: 204.75, cancellationReason: 'manual' },
    installments: [{ number: 1, dueDate: 'i1', amountCents: 5000, paid: 1, paidDate: 'p1' }] });
  for (const [key, value] of Object.entries(figures)) {
    assert.ok(value === null || typeof value === 'boolean' || typeof value === 'string' || Number.isInteger(value), `${key} = ${value}`);
  }
  assert.equal(figures['night.n1'], 10010);
  assert.equal(figures['night.n2'], 9990);
  assert.equal(figures['total.final'], 29250);
  assert.equal(figures['discount.percent'], 1000);
  assert.equal(figures['vat.accommodation.rate'], 1000);
  assert.equal(figures['vat.accommodation.vat'], 1818);
  assert.equal(figures['vat.regime'], 'registered');
  assert.equal(figures['touristTax.total'], 750);
  assert.equal(figures['schedule.deposit'], 8775);
  assert.equal(figures['schedule.balanceDue'], 'd2');
  assert.equal(figures['installment.1.amount'], 5000);
  assert.equal(figures['installment.1.paid'], true);
  assert.equal(figures['paid.collected'], 8775);
  assert.equal(figures['paid.remainingDue'], 20475);
  assert.equal(figures['paid.refundsCash'], 110);
  assert.equal(figures['cancel.indemnity'], 8775);
  assert.equal(figures['cancel.refusal'], null);
});

test('rule 68: every extra line is keyed by its identity and carries quantity, total, offered and routing', () => {
  const figures = figuresOf({ row: row(), quote: quote() });
  assert.equal(figures['line.option:7.total'], 8000);
  assert.equal(figures['line.option:7.quantity'], 1000);
  assert.equal(figures['line.option:7.billedUnits'], 1500);
  assert.equal(figures['line.option:7.inComplement'], true);
  assert.equal(figures['line.option:7.soldeContrib'], 8000);
  assert.equal(figures['line.option:7.acompteContrib'], null);
  assert.equal(figures['line.custom:49.offered'], true);
  assert.equal(figures['line.resource:3.total'], 2000);
});

test('rule 68: two lines on one identity are both kept, the second suffixed', () => {
  const figures = figuresOf({ row: row(), quote: quote({ optionLines: [{ optionId: 7, totalPrice: 1 }, { optionId: 7, totalPrice: 2 }] }) });
  assert.equal(figures['line.option:7.total'], 100);
  assert.equal(figures['line.option:7#2.total'], 200);
});

test('rule 70: the platform figures — commissions, net received, payout, withheld tax, penalty, withheld on cancellation', () => {
  const figures = figuresOf({ row: row({ balancePaid: 1 }), quote: quote() });
  assert.equal(figures['platform.sale'], true);
  assert.equal(figures['platform.commission.solde'], 4025);
  assert.equal(figures['platform.commission.total'], 4025);
  assert.equal(figures['platform.netReceived'], 25225);
  assert.equal(figures['platform.payout'], 25000);
  assert.equal(figures['platform.withheldTax'], 750);
  assert.equal(figures['platform.penalty'], 1234);
  assert.equal(figures['platform.stored.commission.acompte'], 320);
  assert.equal(figures['cancel.withheld.deposit'], 320, 'the acompte was paid to the books');
  assert.equal(figures['cancel.withheld.solde'], 4025);
});

test('rule 70: a cash-paid acompte and an unpaid solde withhold nothing on cancellation', () => {
  const figures = figuresOf({ row: row({ depositPaidCash: 1, balancePaid: 0 }), quote: quote() });
  assert.equal(figures['cancel.withheld.deposit'], 0);
  assert.equal(figures['cancel.withheld.solde'], 0);
});

test('rule 68: a refused cancellation is a figure, a stay with no quote is an error figure', () => {
  assert.equal(figuresOf({ row: row(), quote: quote(), cancellation: { error: 'PLATFORM_RESERVATION', status: 403 } })['cancel.refusal'], 'PLATFORM_RESERVATION');
  const broken = figuresOf({ row: row({ kind: 'devis' }), quote: { error: 'PROPERTY_NOT_FOUND' } });
  assert.equal(broken['quote.error'], 'PROPERTY_NOT_FOUND');
  assert.equal(broken.kind, 'devis');
  assert.equal(figuresOf({ row: row(), quote: null })['quote.error'], 'no quote');
});

test('rule 68: the keys come out sorted and the result does not depend on the order of the lines', () => {
  const a = figuresOf({ row: row(), quote: quote() });
  const b = figuresOf({ row: row(), quote: quote({ nightlyBreakdown: [...quote().nightlyBreakdown].reverse() }) });
  assert.deepEqual(Object.keys(a), [...Object.keys(a)].sort());
  assert.deepEqual(a, b);
});

test('rule 72: the refund figures are cents, a custom line is numbered never named, a stay without a register carries none', () => {
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
  assert.equal(figures['refund.collected'], 27450);
  assert.equal(figures['refund.line.accommodation.refundableTtc'], 10010);
  assert.equal(figures['refund.line.custom#1.refundableTtc'], 3000);
  assert.equal(figures['refund.made.4.line.0.key'], 'custom#1');
  assert.equal(figures['overpayment.stored.ttc'], 525);
  assert.equal(figures['overpayment.stored.line.0.dueTtc'], 2475);
  assert.equal(figures['overpayment.live.ttc'], null);
  assert.equal(figures['refund.journal.4.0.debit'], 909);
  assert.equal(figures['refund.journal.4.1.account'], 'client');
  assert.ok(!Object.keys(figures).concat(Object.values(figures).filter((v) => typeof v === 'string')).some((k) => /private/.test(k)));
  assert.ok(!Object.keys(figuresOf({ row: row(), quote: { error: 'x' }, refunds: null })).some((k) => k.startsWith('refund.')));
});
