// specs/settings-input-guards.md rules 15 and 21 — depositDueDays = 0 reads « due at booking » and
// blocks nothing (arbitration A1 = label only).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { resolveDepositDueDate } = require('../utils/paymentSchedule');
const { validatePropertyInput } = require('../utils/propertyValidation');
const { applyPaidEffect } = require('../utils/paymentPollRunner');

test('rule 15: 0 days is the booking day itself', () => {
  assert.equal(resolveDepositDueDate({ bookingDate: '2027-03-02', depositDueDays: 0 }), '2027-03-02');
  assert.equal(resolveDepositDueDate({ bookingDate: '2027-03-02 10:00:00', depositDueDays: '0' }), '2027-03-02');
});

test('rule 15: the acompte is never due after the solde, a same-day acompte cannot be', () => {
  assert.equal(resolveDepositDueDate({ bookingDate: '2027-03-02', depositDueDays: 0, notAfter: '2027-03-02' }), '2027-03-02');
  assert.equal(resolveDepositDueDate({ bookingDate: '2027-03-02', depositDueDays: 7, notAfter: '2027-03-05' }), '2027-03-05');
});

test('rule 15: nothing is blocked — a property with 0 days saves, and the operator creates reservations as usual', () => {
  assert.deepEqual(validatePropertyInput({ depositEnabled: true, depositDueDays: 0, depositPercent: 30 }), {});
});

test('rule 15: platform reservations are never concerned', () => {
  assert.equal(resolveDepositDueDate({ hasDeposit: false, bookingDate: '2027-03-02', depositDueDays: 0 }), null);
});

test('rule 21: a devis (« Envoyer une demande sans payer » included) never has its acompte due on the booking day', () => {
  assert.equal(resolveDepositDueDate({ kind: 'devis', bookingDate: '2027-03-02', validUntil: '2027-03-16', depositDueDays: 0 }), '2027-03-16');
});

test('rule 21: the website « Payer » converts a devis on payment — the dates are held by the payment alone', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, convertedReservationId INTEGER, depositAmount REAL)');
  db.prepare("INSERT INTO reservations (id, kind, depositAmount) VALUES (1, 'devis', 200)").run();
  const recorded = [];
  const devisModel = { convertToReservation: (id) => ({ data: { reservationId: id + 100 } }) };
  const out = applyPaidEffect({
    database: db, devisModel, link: { reservationId: 1, type: 'deposit' }, recordPayment: (p) => recorded.push(p),
  });
  assert.equal(out.effect, 'converted');
  assert.deepEqual(recorded, [{ reservationId: 101, bucket: 'deposit', paidDate: null }]);
});
