// specs/vat-optional-mode.md rule 38 — the projection to 31 December: the collected figure plus every
// amount still expected before the year ends on a live reservation, past dates included.

const test = require('node:test');
const assert = require('node:assert/strict');

const { franchiseDb, insert, TODAY } = require('./vatFranchiseFixture');
const { expectedOf } = require('../utils/vatFranchise');

const project = (model, today = TODAY) => {
  const f = model.getFollowUp({ today });
  return { collected: f.collected, projected: f.projected, expected: Math.round((f.projected - f.collected) * 100) / 100 };
};

test('rule 38: an unpaid acompte counts on its due date, a solde on its own', () => {
  const { db, model } = franchiseDb();
  insert(db, {
    startDate: '2026-12-10', endDate: '2026-12-13', finalPrice: 600,
    depositAmount: 200, depositDueDate: '2026-11-15', balanceAmount: 400, balanceDueDate: '2026-12-10',
  });
  assert.equal(project(model).expected, 600);
});

test('rule 38: a platform payout is expected endDate + the platform\'s delay (10 days by default)', () => {
  const { db, model } = franchiseDb();
  insert(db, { platform: 'Booking', startDate: '2026-12-10', endDate: '2026-12-20', finalPrice: 500, balanceAmount: 500 });
  insert(db, { platform: 'Booking', startDate: '2026-12-10', endDate: '2026-12-25', finalPrice: 700, balanceAmount: 700 });
  assert.equal(project(model).expected, 500);
});

test('rule 38: the complements fall on the arrival and on the end of the stay', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2026-12-30', endDate: '2027-01-03', finalPrice: 100, complementAmount: 40, endOfStayComplementAmount: 25 });
  insert(db, { startDate: '2026-12-20', endDate: '2026-12-24', finalPrice: 100, complementAmount: 10, endOfStayComplementAmount: 5 });
  assert.equal(project(model).expected, 55);
});

test('rule 38: an unpaid installment counts on its due date, tourist tax removed', () => {
  const { db, model } = franchiseDb();
  const id = insert(db, { startDate: '2027-03-01', endDate: '2027-03-04', finalPrice: 900, touristTaxTotal: 100, installmentsUnpaidAmount: 1000 });
  const put = db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid) VALUES (?, ?, ?, ?, 0)');
  put.run(id, 1, '2026-11-30', 50000);
  put.run(id, 2, '2027-02-01', 50000);
  assert.equal(project(model).expected, 450);
});

test('rule 38: late money is still expected — a past due date counts', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2026-03-01', endDate: '2026-03-04', finalPrice: 300, balanceAmount: 300, balanceDueDate: '2026-02-20' });
  assert.equal(project(model).expected, 300);
});

test('rule 38: a cancelled stay, a devis, a stay paid in the caisse interne and a date after 31/12 add nothing', () => {
  const { db, model } = franchiseDb();
  insert(db, { kind: 'cancelled', startDate: '2026-11-01', endDate: '2026-11-03', finalPrice: 300, balanceAmount: 300, balanceDueDate: '2026-11-01' });
  insert(db, { kind: 'devis', startDate: '2026-11-01', endDate: '2026-11-03', finalPrice: 300, balanceAmount: 300, balanceDueDate: '2026-11-01' });
  insert(db, { startDate: '2026-11-01', endDate: '2026-11-03', finalPrice: 300, balanceAmount: 300, balanceDueDate: '2026-11-01', balancePaid: 1, balancePaidCash: 1 });
  insert(db, { startDate: '2027-01-02', endDate: '2027-01-05', finalPrice: 300, balanceAmount: 300, balanceDueDate: '2027-01-02' });
  assert.equal(project(model).expected, 0);
});

test('rule 38: an unpriced stay adds 0, and the projection is the collected figure plus what is expected', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2026-11-01', endDate: '2026-11-03', finalPrice: 0, balanceAmount: 0, balanceDueDate: '2026-11-01' });
  insert(db, { startDate: '2026-02-01', endDate: '2026-02-03', finalPrice: 100, balanceAmount: 100, balancePaid: 1, balancePaidDate: '2026-02-03' });
  insert(db, { startDate: '2026-11-20', endDate: '2026-11-23', finalPrice: 250, balanceAmount: 250, balanceDueDate: '2026-11-20' });
  assert.deepEqual(project(model), { collected: 100, projected: 350, expected: 250 });
});

test('rule 38: an acompte without a due date is expected on the arrival', () => {
  const stay = { id: 1, startDate: '2026-12-01', endDate: '2026-12-04', depositAmount: 80 };
  const share = (id, amount) => amount;
  assert.equal(expectedOf({ stay, yearStart: '2026-01-01', yearEnd: '2026-12-31', share }), 80);
  assert.equal(expectedOf({ stay: { ...stay, startDate: '2027-01-01' }, yearStart: '2026-01-01', yearEnd: '2026-12-31', share }), 0);
});

test('rule 38: unpaid money older than 1 January of the year is not projected — it stays in « En retard »', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2023-03-01', endDate: '2023-03-04', finalPrice: 900, balanceAmount: 900, balanceDueDate: '2023-02-20' });
  insert(db, { startDate: '2025-12-20', endDate: '2025-12-24', finalPrice: 100, balanceAmount: 100, balanceDueDate: '2025-12-31' });
  insert(db, { startDate: '2026-01-01', endDate: '2026-01-04', finalPrice: 40, balanceAmount: 40, balanceDueDate: '2026-01-01' });
  assert.equal(project(model).expected, 40);
  assert.equal(project(model, '2027-03-01').expected, 0);
});

test('rule 38: a pending compensation expected within the year is projected at face value, other years are not', () => {
  const { db, model } = franchiseDb();
  const put = db.prepare("INSERT INTO cancellation_compensations (reservationId, status, expectedAmount, expectedDate) VALUES (NULL, 'pending', ?, ?)");
  put.run(120, '2026-11-30');
  put.run(70, '2026-01-01');
  put.run(500, '2027-01-02');
  put.run(300, '2025-12-31');
  assert.equal(project(model).expected, 190);
});
