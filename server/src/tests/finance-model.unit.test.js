const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    finalPrice REAL, depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositDueDate TEXT,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balanceDueDate TEXT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT,
    complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
    endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0
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
    depositAmount, depositPaid, depositDueDate, balanceAmount, balancePaid, balanceDueDate,
    complementAmount, complementPaid)
  VALUES (@id, @clientId, @propertyId, @startDate, @endDate, @finalPrice,
    @depositAmount, @depositPaid, @depositDueDate, @balanceAmount, @balancePaid, @balanceDueDate,
    @complementAmount, @complementPaid)
`).run({
  depositPaid: 0, balancePaid: 0, depositDueDate: null, balanceDueDate: null,
  complementAmount: 0, complementPaid: 0,
  ...r,
});

test('getSummary enriches reservations with remainingDue + paymentComplete and totals', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), finalPrice: 500, depositAmount: 150, depositPaid: 1, balanceAmount: 350, balancePaid: 0 });
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), finalPrice: 300, depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 1 });

  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.totalRevenue, 800);
  assert.equal(summary.totalCollected, 150 + 100 + 200); // 450
  assert.equal(summary.totalPending, 350); // only res1 balance unpaid
  // The 3 cards add up by construction (regression: pre-2026-06-02 totalRevenue used
  // `finalPrice` so it diverged from collected + pending as soon as tax / complement
  // entered the picture).
  assert.equal(summary.totalRevenue, summary.totalCollected + summary.totalPending);
  const r1 = summary.reservations.find((r) => r.id === 1);
  assert.equal(r1.remainingDue, 350);
  assert.equal(r1.paymentComplete, false);
  const r2 = summary.reservations.find((r) => r.id === 2);
  assert.equal(r2.remainingDue, 0);
  assert.equal(r2.paymentComplete, true);
});

test('getSummary: complementAmount + complementPaid feed totalCollected + totalPending too', () => {
  // Regression: prior to 2026-06-02 the 3rd payment bucket (complément) was ignored. A stay
  // with a paid complement showed up in the operational tables but didn't move the Encaissé
  // card — Adrien noticed "les montants ne sont pas cohérents".
  const { db, model } = freshModel();
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4),
    finalPrice: 500,
    depositAmount: 150, depositPaid: 1,
    balanceAmount: 350, balancePaid: 1,
    complementAmount: 20, complementPaid: 1,
  });
  insertRes(db, {
    id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5),
    finalPrice: 300,
    depositAmount: 90,  depositPaid: 0,
    balanceAmount: 210, balancePaid: 0,
    complementAmount: 30, complementPaid: 0,
  });

  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  // Collected = res1 (deposit + balance + complement) = 520.
  assert.equal(summary.totalCollected, 150 + 350 + 20);
  // Pending = res2 (deposit + balance + complement) = 330.
  assert.equal(summary.totalPending,   90 + 210 + 30);
  // Revenue is driven by encaissements, NOT finalPrice — so collected + pending == revenue.
  assert.equal(summary.totalRevenue, summary.totalCollected + summary.totalPending);
});

test('getSummary returns revenueByProperty aggregated per logement, sorted desc', () => {
  // Drives the "Revenus par logement" chart on FinancePage (replaces the per-reservation bar
  // chart which became unreadable at scale).
  const { db, model } = freshModel();
  // Property 1 (Gite) — two reservations. Res1: deposit 100 paid + balance 200 unpaid (=300).
  // Res2: deposit 100 paid + balance 100 unpaid (=200). Sum: collected 200, pending 300, rev 500.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(3), finalPrice: 300, depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 0 });
  insertRes(db, { id: 2, clientId: 1, propertyId: 1, startDate: iso(4), endDate: iso(6), finalPrice: 300, depositAmount: 100, depositPaid: 1, balanceAmount: 100, balancePaid: 0 });
  // Property 2 (Tente) — one fully paid reservation: collected 200, pending 0, rev 200.
  insertRes(db, { id: 3, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(4), finalPrice: 200, depositAmount: 60, depositPaid: 1, balanceAmount: 140, balancePaid: 1 });

  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.revenueByProperty.length, 2);

  // Sorted descending by revenue → Gite (500) first, Tente (200) second.
  const [gite, tente] = summary.revenueByProperty;
  assert.equal(gite.propertyName, 'Gite');
  assert.equal(gite.revenue,   500);
  assert.equal(gite.collected, 200);
  assert.equal(gite.pending,   300);
  assert.equal(tente.propertyName, 'Tente');
  assert.equal(tente.revenue,   200);
  assert.equal(tente.collected, 200);
  assert.equal(tente.pending,   0);
});

test('getSummary revenueByProperty: empty range → empty list (no crash, no zero placeholder)', () => {
  const { model } = freshModel();
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.deepEqual(summary.revenueByProperty, []);
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

test('a kind=devis row never leaks into finance revenue/overdue/pending/upcoming', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), finalPrice: 500, depositAmount: 150, balanceAmount: 350, depositDueDate: iso(-5) });
  // A devis (kind='devis') with a huge price + overdue date — must be invisible to every finance view.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, finalPrice, depositAmount, depositDueDate, balanceAmount, depositPaid, balancePaid) VALUES (99, 'devis', 1, 1, ?, ?, 9999, 5000, ?, 4999, 0, 0)")
    .run(iso(1), iso(4), iso(-30));

  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.totalRevenue, 500); // devis 9999 excluded
  assert.ok(!summary.reservations.some((r) => r.id === 99));

  const op = model.getOperational();
  assert.ok(!op.overdue.reservations.some((r) => r.id === 99));
  assert.ok(!op.pending.reservations.some((r) => r.id === 99));
  assert.ok(!op.upcoming.reservations.some((r) => r.id === 99));
});

// ── Cash complements + end-of-stay complement (specs/cash-complement-and-endofstay-finance.md) ──

test('getSummary: a « caisse interne » arrival complement STILL counts as collected (only excluded from compta)', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), finalPrice: 250, depositAmount: 200, depositPaid: 1, balanceAmount: 0, complementAmount: 50, complementPaid: 1 });
  db.prepare('UPDATE reservations SET complementPaidCash = 1 WHERE id = 1').run();
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  // 200 deposit + 50 caisse-interne complement = 250 collected (it's money in — only the accounting
  // export excludes it).
  assert.equal(summary.totalCollected, 250);
  assert.equal(summary.totalPending, 0);
});

test('getSummary: end-of-stay complement feeds collected (paid) / pending (due) like the arrival complement', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), finalPrice: 100, depositAmount: 100, depositPaid: 1, balanceAmount: 0 });
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 40, endOfStayComplementPaid = 1 WHERE id = 1').run();
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), finalPrice: 100, depositAmount: 100, depositPaid: 1, balanceAmount: 0 });
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 25, endOfStayComplementPaid = 0 WHERE id = 2').run();
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.totalCollected, 100 + 100 + 40); // deposits + paid end-of-stay
  assert.equal(summary.totalPending, 25);               // unpaid end-of-stay
});

test('getSummary: a « caisse interne » end-of-stay complement STILL counts as collected', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), finalPrice: 100, depositAmount: 100, depositPaid: 1, balanceAmount: 0 });
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 40, endOfStayComplementPaid = 1, endOfStayComplementPaidCash = 1 WHERE id = 1').run();
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.totalCollected, 140); // deposit + caisse-interne end-of-stay (in finance, not compta)
  assert.equal(summary.totalPending, 0);
});
