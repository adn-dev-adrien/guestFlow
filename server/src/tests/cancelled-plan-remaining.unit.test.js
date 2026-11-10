// specs/reservation-payment-ledger.md rule 73 (audit R42-M-L1, 2026-11-10) — a cancellation writes a plan's unpaid
// installments off (« Solde abandonné ») and the cancelled fiche draws no plan row: `remainingToPay`, the one « reste dû »
// of the application, no longer counts them. The fiche used to close on « Reste à percevoir 3 089,60 € » under rows that
// all said nothing was owed. A live plan still counts them; a cancelled stay without a plan keeps its rows' reading.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLedger } = require('../utils/reservationLedger');
const { remainingToPay } = require('../utils/reservationSettlement');
const { computePaymentStatus } = require('../utils/paymentStatus');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const inDays = (n) => addDaysToIsoDate(todayIso(), n);
const TODAY = inDays(0);
const planStay = (over = {}) => ({
  id: 9, kind: 'reservation', platform: 'direct', startDate: inDays(60), endDate: inDays(67), finalPrice: 3089.6,
  depositAmount: 0, balanceAmount: 0, complementAmount: 0, endOfStayComplementAmount: 0,
  depositPaid: 0, balancePaid: 0, complementPaid: 0, endOfStayComplementPaid: 0, cautionReceived: 0, cautionReturned: 0,
  installmentsPaidAmount: 0, installmentsUnpaidAmount: 3089.6, installmentsTarget: 3089.6,
  ...over,
});

test('rule 73 — a cancelled plan stay owes nothing: the fiche closes without « Reste à percevoir », the status agrees', () => {
  const row = planStay({ kind: 'cancelled' });
  assert.equal(remainingToPay(row), 0);
  const ledger = buildLedger({ row, refunds: [], today: TODAY });
  assert.equal(ledger.remaining, 0);
  assert.notEqual(ledger.closing.label, 'Reste à percevoir');
  assert.equal(ledger.closing.amount, null);
  // Verification R42 L4: nothing was collected, so not « Tout est perçu » either — the rows' own words.
  assert.deepEqual(ledger.closing, { label: 'Rien à percevoir', amount: null, tone: 'muted' });
  assert.equal(ledger.remainingLabel, 'Rien à percevoir');
  assert.equal(computePaymentStatus(row, TODAY).remainingDue, 0);
});

test('rule 73 — a live plan stay still owes its unpaid installments', () => {
  const row = planStay();
  assert.equal(remainingToPay(row), 3089.6);
  assert.equal(computePaymentStatus(row, TODAY).remainingDue, 3089.6);
});

test('rule 73 — a cancelled stay without a plan keeps its unpaid solde, as its row says', () => {
  const row = planStay({ kind: 'cancelled', balanceAmount: 535.01, installmentsUnpaidAmount: 0, installmentsTarget: 0 });
  assert.equal(remainingToPay(row), 535.01);
  const ledger = buildLedger({ row, refunds: [], today: TODAY });
  assert.equal(ledger.closing.label, 'Reste à percevoir');
  assert.equal(ledger.closing.amount, 535.01);
});
