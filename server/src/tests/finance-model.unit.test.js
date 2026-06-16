const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/finance-overview-rework.md — every revenue figure is Σ « total de séjour » (acompte + solde +
// complément + complément fin de séjour, the two complements EXCLUDED when caisse interne), a reservation
// counted by its DEPARTURE date (endDate). « Encaissé » = the accounting total (paid, excl. caisse
// interne). « En attente » = Σ total-séjour of PAST + non-settled reservations.
const financeModel = require('../models/financeModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    finalPrice REAL, depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balanceDueDate TEXT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT, complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
    endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0
  );
`;

function iso(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().split('T')[0];
}
const TODAY = new Date().toISOString().split('T')[0];

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Tente')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont'), (2, 'Marie', 'Martin')").run();
  return { db, model: financeModel.buildModel(db) };
}

const COLS = [
  'id', 'clientId', 'propertyId', 'startDate', 'endDate', 'platform', 'finalPrice',
  'depositAmount', 'depositPaid', 'depositDueDate', 'depositDisabled',
  'balanceAmount', 'balancePaid', 'balanceDueDate',
  'complementAmount', 'complementPaid', 'complementPaidCash',
  'endOfStayComplementAmount', 'endOfStayComplementPaid', 'endOfStayComplementPaidCash',
];
const insertRes = (db, r) => db.prepare(
  `INSERT INTO reservations (${COLS.join(', ')}) VALUES (${COLS.map((c) => `@${c}`).join(', ')})`,
).run({
  platform: 'direct', finalPrice: 0,
  depositAmount: 0, depositPaid: 0, depositDueDate: null, depositDisabled: 0,
  balanceAmount: 0, balancePaid: 0, balanceDueDate: null,
  complementAmount: 0, complementPaid: 0, complementPaidCash: 0,
  endOfStayComplementAmount: 0, endOfStayComplementPaid: 0, endOfStayComplementPaidCash: 0,
  ...r,
});

// ── total de séjour + summary totals ──────────────────────────────────────────────────

test('getSummary: revenueTotal = Σ total-de-séjour (acompte+solde+complément+fin de séjour), by endDate', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 150, balanceAmount: 350, complementAmount: 20, endOfStayComplementAmount: 30 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.revenueTotal, 550); // 150 + 350 + 20 + 30
});

test('getSummary: caisse-interne complements are EXCLUDED from the total de séjour', () => {
  const { db, model } = freshModel();
  // Arrival complement 50 + end-of-stay 30, both caisse interne → excluded; only 150+350 count.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 150, balanceAmount: 350, complementAmount: 50, complementPaid: 1, complementPaidCash: 1, endOfStayComplementAmount: 30, endOfStayComplementPaid: 1, endOfStayComplementPaidCash: 1 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.revenueTotal, 500);
});

test('getSummary: totalCollected = accounting total (paid, EXCLUDING caisse interne)', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 150, depositPaid: 1, balanceAmount: 350, balancePaid: 0, complementAmount: 50, complementPaid: 1, complementPaidCash: 1 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.totalCollected, 150); // deposit paid; balance unpaid; caisse-interne complement excluded from compta
});

test('getSummary: totalPending = Σ total-de-séjour of PAST + non-settled only', () => {
  const { db, model } = freshModel();
  // Past + unpaid → counts the WHOLE stay total.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), depositAmount: 100, depositPaid: 0, balanceAmount: 200, balancePaid: 0 });
  // Future + unpaid → NOT pending (not past).
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), depositAmount: 100, balanceAmount: 200 });
  // Past + fully settled → NOT pending.
  insertRes(db, { id: 3, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-3), depositAmount: 100, depositPaid: 1, balanceAmount: 50, balancePaid: 1 });
  const summary = model.getSummary({ from: iso(-10), to: iso(10) });
  assert.equal(summary.totalPending, 300); // only res1's whole stay total
});

test('getSummary: a caisse-interne complement makes a past reservation settled → not pending', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), depositAmount: 100, depositPaid: 1, balanceAmount: 0, complementAmount: 40, complementPaid: 1, complementPaidCash: 1 });
  const summary = model.getSummary({ from: iso(-10), to: iso(10) });
  assert.equal(summary.totalPending, 0);
});

test('getSummary: revenueByProperty sums total-de-séjour per property, sorted desc', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(3), depositAmount: 100, balanceAmount: 200 }); // Gite 300
  insertRes(db, { id: 2, clientId: 1, propertyId: 1, startDate: iso(4), endDate: iso(6), depositAmount: 100, balanceAmount: 100 }); // Gite 200 → 500
  insertRes(db, { id: 3, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(4), depositAmount: 60, balanceAmount: 140 });  // Tente 200
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.deepEqual(summary.revenueByProperty.map((p) => [p.propertyName, p.revenue]), [['Gite', 500], ['Tente', 200]]);
  assert.equal(summary.revenueByProperty[0].collected, undefined); // single value now, no collected/pending split
});

test('getSummary: yearToDate (Jan 1 → today) + yearTotal (full year), by endDate', () => {
  const { db, model } = freshModel();
  const Y = new Date().getFullYear();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: `${Y}-01-02`, endDate: `${Y}-01-05`, depositAmount: 100 }); // early this year
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: `${Y}-12-20`, endDate: `${Y}-12-25`, depositAmount: 100 }); // late this year
  const summary = model.getSummary({ from: `${Y}-01-01`, to: `${Y}-12-31` });
  const expectedYtd = (`${Y}-01-05` <= TODAY ? 100 : 0) + (`${Y}-12-25` <= TODAY ? 100 : 0);
  assert.equal(summary.yearToDate, expectedYtd);
  assert.equal(summary.yearTotal, 200);
});

test('getSummary: empty range → empty revenueByProperty (no crash)', () => {
  const { model } = freshModel();
  assert.deepEqual(model.getSummary({ from: iso(0), to: iso(10) }).revenueByProperty, []);
});

test('getSummary: a kind=devis row never leaks into the revenue', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 200, balanceAmount: 300 });
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, depositAmount, balanceAmount) VALUES (99, 'devis', 1, 1, ?, ?, 5000, 4999)").run(iso(1), iso(4));
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.revenueTotal, 500);
  assert.ok(!summary.reservations.some((r) => r.id === 99));
});

// ── operational ───────────────────────────────────────────────────────────────────────

test('getOperational: overdue lists DIRECT bookings only (platforms manage their own payments)', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(10), endDate: iso(13), platform: 'direct', depositAmount: 150, depositDueDate: iso(-5), balanceAmount: 350, balanceDueDate: iso(20) });
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(8), endDate: iso(10), platform: 'Airbnb', depositAmount: 120, depositDueDate: iso(-20), balanceAmount: 280, balanceDueDate: iso(-2) });
  const op = model.getOperational();
  assert.deepEqual(op.overdue.reservations.map((r) => r.id), [1]); // the Airbnb one is excluded
});

test('getOperational: pending = PAST + non-settled, amount = total de séjour; caisse interne settles it', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), depositAmount: 100, balanceAmount: 200 }); // past unpaid
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), depositAmount: 100, balanceAmount: 200 });   // future → not pending
  insertRes(db, { id: 3, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-3), depositAmount: 100, depositPaid: 1, balanceAmount: 0, complementAmount: 40, complementPaid: 1, complementPaidCash: 1 }); // past but caisse-interne → settled
  const op = model.getOperational();
  assert.deepEqual(op.pending.reservations.map((r) => r.id), [1]);
  assert.equal(op.pending.reservations[0].totalSejour, 300);
});

test('getOperational: upcoming = endDate >= today, carries totalSejour + nights, caps at 5 per property', () => {
  const { db, model } = freshModel();
  for (let i = 1; i <= 7; i += 1) insertRes(db, { id: i, clientId: 1, propertyId: 1, startDate: iso(i), endDate: iso(i + 2), balanceAmount: 100 });
  const op = model.getOperational();
  assert.equal(op.upcoming.reservations.length, 5);
  assert.equal(op.upcoming.reservations[0].totalSejour, 100);
  assert.equal(op.upcoming.reservations[0].nights, 2);
});

// ── projection ────────────────────────────────────────────────────────────────────────

test('getProjection: Σ total-de-séjour of reservations whose endDate ≤ target; collected = compta', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-3), endDate: iso(-1), depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 0 }); // before target
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(20), endDate: iso(40), depositAmount: 500, balanceAmount: 500 }); // after target
  const proj = model.getProjection({ date: iso(10) });
  assert.equal(proj.total, 300);      // only res1's stay total (endDate ≤ target)
  assert.equal(proj.collected, 100);  // deposit paid
  assert.equal(proj.pending, 200);
});

// ── tourist-tax extraction (unchanged) ──────────────────────────────────────────────────

test('getTouristTaxExtraction rejects a non-past or malformed month', () => {
  const { model } = freshModel();
  assert.equal(model.getTouristTaxExtraction({ month: 'bad' }).status, 400);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  assert.equal(model.getTouristTaxExtraction({ month: thisMonth }).status, 400);
});
