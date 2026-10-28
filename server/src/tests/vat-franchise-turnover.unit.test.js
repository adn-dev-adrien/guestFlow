// specs/vat-optional-mode.md rules 37 and 41 — the turnover collected during the calendar year: each
// payment on its own date, gross of the platform commission, without tourist tax (nor VAT under a taxed
// period), caisse interne left out, and last year beside it.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  franchiseDb, insert, addPeriod, addRefund, TODAY,
} = require('./vatFranchiseFixture');

const collected = (model, today = TODAY) => model.getFollowUp({ today }).collected;

test('rule 37: the year runs 1 January to 31 December, on the date of each payment', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2026-02-01', endDate: '2026-02-03', finalPrice: 500, depositAmount: 100, depositPaid: 1, depositPaidDate: '2026-01-01', balanceAmount: 400, balancePaid: 1, balancePaidDate: '2026-12-31' });
  insert(db, { startDate: '2026-02-01', endDate: '2026-02-03', finalPrice: 500, depositAmount: 50, depositPaid: 1, depositPaidDate: '2025-12-31', balanceAmount: 450, balancePaid: 1, balancePaidDate: '2027-01-01' });
  assert.equal(collected(model), 500);
});

test('rule 37: a December acompte of a stay in March counts in December, not in March', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2027-03-10', endDate: '2027-03-13', finalPrice: 600, depositAmount: 200, depositPaid: 1, depositPaidDate: '2026-12-10', balanceAmount: 400 });
  assert.equal(collected(model), 200);
  assert.equal(collected(model, '2027-03-20'), 0);
});

test('rule 37 (a): the platform commission is added back — on the acompte and on the payout', () => {
  const { db, model } = franchiseDb();
  insert(db, {
    platform: 'Booking', startDate: '2026-05-01', endDate: '2026-05-04', finalPrice: 1000,
    depositAmount: 200, depositPaid: 1, depositPaidDate: '2026-04-01', acompteCommissionAmount: 30,
    balanceAmount: 800, balancePaid: 1, balancePaidDate: '2026-05-06', platformCommissionAmount: 120,
  });
  assert.equal(collected(model), 1000);
});

test('rule 37 (b): the tourist tax is not turnover — the stay\'s own ratio applies to every payment', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2026-06-01', endDate: '2026-06-05', finalPrice: 900, touristTaxTotal: 100, depositAmount: 400, depositPaid: 1, depositPaidDate: '2026-05-01', balanceAmount: 600, balancePaid: 1, balancePaidDate: '2026-06-01' });
  assert.equal(collected(model), 900);
});

test('rule 37 (b): a stay priced 0 € with only tourist tax counts 0', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2026-06-01', endDate: '2026-06-05', finalPrice: 0, touristTaxTotal: 40, balanceAmount: 40, balancePaid: 1, balancePaidDate: '2026-06-01' });
  assert.equal(collected(model), 0);
});

test('rule 37 (b): a year that began under VAT adds HT figures for the stays sold under it', () => {
  const { db, model } = franchiseDb({ regime: 'subject' });
  const franchise = addPeriod(db, 'not_subject', 0, 'art_293_b');
  insert(db, { vatPeriodId: 1, startDate: '2026-02-01', endDate: '2026-02-03', finalPrice: 1100, balanceAmount: 1100, balancePaid: 1, balancePaidDate: '2026-02-03' });
  insert(db, { vatPeriodId: franchise, startDate: '2026-08-01', endDate: '2026-08-03', finalPrice: 1100, balanceAmount: 1100, balancePaid: 1, balancePaidDate: '2026-08-03' });
  assert.equal(collected(model), 2100);
});

test('rule 37 (c): a refund subtracts on its own date, with the stay\'s ratio — a January refund lowers the new year', () => {
  const { db, model } = franchiseDb();
  const id = insert(db, { startDate: '2026-12-20', endDate: '2026-12-22', finalPrice: 900, touristTaxTotal: 100, balanceAmount: 1000, balancePaid: 1, balancePaidDate: '2026-12-01' });
  addRefund(db, id, '2027-01-05', 500);
  assert.equal(collected(model, '2026-12-15'), 900);
  assert.equal(collected(model, '2027-01-10'), -450);
});

test('rule 37 (d): money collected in the caisse interne is left out, and so is an internal refund', () => {
  const { db, model } = franchiseDb();
  const cash = insert(db, { startDate: '2026-03-01', endDate: '2026-03-03', finalPrice: 300, balanceAmount: 300, balancePaid: 1, balancePaidDate: '2026-03-03', balancePaidCash: 1 });
  const bank = insert(db, { startDate: '2026-04-01', endDate: '2026-04-03', finalPrice: 200, balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-04-03' });
  addRefund(db, bank, '2026-04-10', 60, 'internal');
  addRefund(db, cash, '2026-03-10', 20, 'internal');
  assert.equal(collected(model), 200);
});

test('rule 37 (e): a cancellation compensation counts on its received date; a pending one does not', () => {
  const { db, model } = franchiseDb();
  db.prepare("INSERT INTO cancellation_compensations (reservationId, receivedAmount, receivedDate, status) VALUES (NULL, 150, '2026-07-01', 'received')").run();
  db.prepare("INSERT INTO cancellation_compensations (reservationId, receivedAmount, receivedDate, status) VALUES (NULL, 90, NULL, 'pending')").run();
  db.prepare("INSERT INTO cancellation_compensations (reservationId, receivedAmount, receivedDate, status) VALUES (NULL, 70, '2025-07-01', 'received')").run();
  assert.equal(collected(model), 150);
});

test('rule 37 (e): a cancelled stay\'s refunded acompte is received then refunded; in the same year it nets to zero', () => {
  const { db, model } = franchiseDb();
  const id = insert(db, { kind: 'cancelled', startDate: '2026-09-01', endDate: '2026-09-04', finalPrice: 800, depositAmount: 200, depositPaid: 1, depositPaidDate: '2026-03-01' });
  assert.equal(collected(model), 200);
  addRefund(db, id, '2026-04-01', 200);
  assert.equal(collected(model), 0);
});

test('rule 37: each collected installment is a payment of its own, on its own day', () => {
  const { db, model } = franchiseDb();
  const id = insert(db, { startDate: '2026-09-01', endDate: '2026-09-04', finalPrice: 900, touristTaxTotal: 100, installmentsPaidAmount: 500 });
  const put = db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid, paidDate) VALUES (?, ?, ?, ?, 1, ?)');
  put.run(id, 1, '2025-12-20', 20000, '2025-12-20');
  put.run(id, 2, '2026-01-10', 30000, '2026-01-10');
  assert.equal(collected(model), 270);
});

test('rule 41: last year sits beside it — shown with 0 € as soon as the install has a stay then, absent otherwise', () => {
  const { db, model } = franchiseDb();
  assert.equal(model.getFollowUp({ today: TODAY }).previousYear, null);
  insert(db, { startDate: '2025-06-01', endDate: '2025-06-04', finalPrice: 400, balanceAmount: 400, balancePaid: 1, balancePaidDate: '2025-06-04' });
  insert(db, { startDate: '2026-06-01', endDate: '2026-06-04', finalPrice: 100, balanceAmount: 100, balancePaid: 1, balancePaidDate: '2026-06-04' });
  assert.deepEqual(model.getFollowUp({ today: TODAY }).previousYear, { year: 2025, collected: 400 });
  assert.deepEqual(model.getFollowUp({ today: '2027-02-01' }).previousYear, { year: 2026, collected: 100 });
  assert.deepEqual(model.getFollowUp({ today: '2028-02-01' }).previousYear, null);
});

test('rule 41: a year with only a stay and no payment shows its 0 €', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2025-06-01', endDate: '2025-06-04', finalPrice: 400, balanceAmount: 400 });
  assert.deepEqual(model.getFollowUp({ today: TODAY }).previousYear, { year: 2025, collected: 0 });
});
