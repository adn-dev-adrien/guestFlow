// specs/finance-dashboard-redesign.md rules 34 + 49, specs/direct-installments.md rules 14 + 48 (spec review of
// 2026-10-27, agent 3 F3) — an installment the fiche calls « En retard » is late on the Finance page too:
// the « En retard » tile, its insight and its detail list it, and « Marquer payé » records it through its
// own endpoint. Before, `overdueOf` only knew the acompte, the solde and the platform payout, so a stay
// paid through a plan was never late.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ paid = 0, target = 515 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  // Added by a boot migration of database.js, not by the schema.sql baseline.
  if (!db.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'reservationNumber')) {
    db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  }
  const today = todayIso();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Revue')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Revue')").run();
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, kind, platform, startDate, endDate, finalPrice, touristTaxTotal,
      depositAmount, balanceAmount, installmentsPaidAmount, installmentsUnpaidAmount, installmentsTarget)
    VALUES (1, 1, 1, 'reservation', 'direct', ?, ?, 500, 15, 0, 0, ?, ?, ?)`)
    .run(addDaysToIsoDate(today, 120), addDaysToIsoDate(today, 125), paid / 100, (51500 - paid) / 100, target);
  const insert = db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid) VALUES (1, ?, ?, ?, ?)');
  insert.run(1, addDaysToIsoDate(today, -10), 17200, paid > 0 ? 1 : 0);
  insert.run(2, addDaysToIsoDate(today, -5), 17200, 0);
  insert.run(3, addDaysToIsoDate(today, 60), 17100, 0);
  return db;
}

test('F3 — late installments make the stay late, each one an element of its own', () => {
  const db = seed();
  const { overdue } = financeModel.buildModel(db).getOperational();
  assert.equal(overdue.count, 1);
  assert.equal(overdue.totalAmount, 344);
  const [row] = overdue.reservations;
  assert.deepEqual(row.overdueItems.map((i) => [i.label, i.amount, i.installmentId, i.paidField]), [
    ['Échéance 1/3', 172, 1, null],
    ['Échéance 2/3', 172, 2, null],
  ]);
  assert.equal(row.oldestDueDate, addDaysToIsoDate(todayIso(), -10));
});

test('F3 — an installment not yet three days past due is not late (the fiche’s « En retard »)', () => {
  const db = seed();
  db.prepare('UPDATE reservation_installments SET dueDate = ? WHERE number = 2').run(addDaysToIsoDate(todayIso(), -1));
  const { overdue } = financeModel.buildModel(db).getOperational();
  assert.deepEqual(overdue.reservations[0].overdueItems.map((i) => i.label), ['Échéance 1/3']);
});

test('F3 — a plan covered by what it collected owes nothing, so nothing is late', () => {
  const db = seed({ paid: 17200, target: 172 });
  const { overdue } = financeModel.buildModel(db).getOperational();
  assert.equal(overdue.count, 0);
});
