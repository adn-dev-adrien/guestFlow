const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    finalPrice REAL, depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositDueDate TEXT,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balanceDueDate TEXT
  );
`;

function iso(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().split('T')[0];
}

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Tente')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont'), (2, 'Marie', 'Martin')").run();
  return { db, model: financeModel.buildModel(db) };
}

const insertRes = (db, r) => db.prepare(`
  INSERT INTO reservations (id, clientId, propertyId, startDate, endDate, finalPrice,
    depositAmount, depositPaid, depositDueDate, balanceAmount, balancePaid, balanceDueDate)
  VALUES (@id, @clientId, @propertyId, @startDate, @endDate, @finalPrice,
    @depositAmount, @depositPaid, @depositDueDate, @balanceAmount, @balancePaid, @balanceDueDate)
`).run({ depositPaid: 0, balancePaid: 0, depositDueDate: null, balanceDueDate: null, ...r });

test('getSummary enriches reservations with remainingDue + paymentComplete and totals', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), finalPrice: 500, depositAmount: 150, depositPaid: 1, balanceAmount: 350, balancePaid: 0 });
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), finalPrice: 300, depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 1 });

  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.totalRevenue, 800);
  assert.equal(summary.totalCollected, 150 + 100 + 200); // 450
  assert.equal(summary.totalPending, 350); // only res1 balance unpaid
  const r1 = summary.reservations.find((r) => r.id === 1);
  assert.equal(r1.remainingDue, 350);
  assert.equal(r1.paymentComplete, false);
  const r2 = summary.reservations.find((r) => r.id === 2);
  assert.equal(r2.remainingDue, 0);
  assert.equal(r2.paymentComplete, true);
});

test('getOperational shapes overdue (sorted + totals), pending and upcoming', () => {
  const { db, model } = freshModel();
  // Overdue deposit (past due, unpaid), balance not yet due.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(20), endDate: iso(23), finalPrice: 500, depositAmount: 150, depositDueDate: iso(-10), balanceAmount: 350, balanceDueDate: iso(15) });
  // Both overdue, older deposit due date than res 1.
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(8), endDate: iso(10), finalPrice: 400, depositAmount: 120, depositDueDate: iso(-20), balanceAmount: 280, balanceDueDate: iso(-2) });
  // Pending but not overdue (deposit due in the future).
  insertRes(db, { id: 3, clientId: 1, propertyId: 1, startDate: iso(30), endDate: iso(33), finalPrice: 600, depositAmount: 200, depositDueDate: iso(5), balanceAmount: 400, balanceDueDate: iso(25) });
  // Fully paid → excluded from pending.
  insertRes(db, { id: 4, clientId: 2, propertyId: 2, startDate: iso(1), endDate: iso(3), finalPrice: 300, depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 1 });

  const op = model.getOperational();

  // overdue: res 2 (older oldestDueDate) then res 1
  assert.equal(op.overdue.count, 2);
  assert.deepEqual(op.overdue.reservations.map((r) => r.id), [2, 1]);
  assert.equal(op.overdue.totalAmount, (120 + 280) + 150); // res2 both overdue + res1 deposit only = 550
  assert.equal(op.overdue.reservations[0].overdueAmount, 400);
  assert.equal(op.overdue.reservations[1].overdueAmount, 150);

  // pending: res 1, 2, 3 (not the fully paid 4)
  assert.deepEqual(op.pending.reservations.map((r) => r.id).sort(), [1, 2, 3]);

  // upcoming: not-yet-ended (endDate >= today) → all of 1,2,3,4; each has nights + remainingDue
  const upcomingIds = op.upcoming.reservations.map((r) => r.id).sort();
  assert.deepEqual(upcomingIds, [1, 2, 3, 4]);
  const up1 = op.upcoming.reservations.find((r) => r.id === 1);
  assert.equal(up1.nights, 3);
  assert.equal(up1.remainingDue, 500);
});

test('getOperational caps upcoming at 5 per property', () => {
  const { db, model } = freshModel();
  for (let i = 1; i <= 7; i++) {
    insertRes(db, { id: i, clientId: 1, propertyId: 1, startDate: iso(i), endDate: iso(i + 2), finalPrice: 100, depositAmount: 0, balanceAmount: 100 });
  }
  const op = model.getOperational();
  assert.equal(op.upcoming.reservations.length, 5);
});

test('getTouristTaxExtraction rejects a non-past or malformed month', () => {
  const { model } = freshModel();
  assert.equal(model.getTouristTaxExtraction({ month: 'bad' }).status, 400);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  assert.equal(model.getTouristTaxExtraction({ month: thisMonth }).status, 400);
});
