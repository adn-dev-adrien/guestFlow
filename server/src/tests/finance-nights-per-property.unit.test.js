const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/fiscal-year-and-nights-sold.md §3.3 — nights SOLD per logement, on the same windows and the
// same attribution as the money, so « X € » and « N nuits » on a card always describe the same set.
const financeModel = require('../models/financeModel');

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10, fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0,
    depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT, balanceDueDate TEXT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0, endOfStayComplementPaidCash INTEGER DEFAULT 0,
    midStaySettledNotes TEXT,
    platformCommissionAmount REAL, acompteCommissionAmount REAL
  );
  CREATE TABLE reservation_refunds (
    id INTEGER PRIMARY KEY, reservationId INTEGER, totalTtc REAL DEFAULT 0, method TEXT DEFAULT 'transfer'
  );
  CREATE TABLE reservation_refund_lines (
    id INTEGER PRIMARY KEY, refundId INTEGER, lineKey TEXT, amountTtc REAL DEFAULT 0, quantity REAL DEFAULT 0
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
  db.prepare('INSERT INTO app_settings (id, vatRate, fiscalYearEndMonth) VALUES (1, 10, 12)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Lodge'), (3, 'Cabane')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont'), (2, 'Marie', 'Martin')").run();
  return { db, model: financeModel.buildModel(db) };
}

const COLS = ['id', 'clientId', 'propertyId', 'startDate', 'endDate', 'finalPrice', 'depositAmount', 'depositPaid'];
const insertRes = (db, r) => db.prepare(
  `INSERT INTO reservations (${COLS.join(', ')}) VALUES (${COLS.map((c) => `@${c}`).join(', ')})`,
).run({ finalPrice: 0, depositAmount: 0, depositPaid: 0, ...r });

test('nights are counted per logement over the period, zero-seeded and sorted like the revenue', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-10), endDate: iso(-7), depositAmount: 300 }); // Gite, 3 nuits
  insertRes(db, { id: 2, clientId: 2, propertyId: 1, startDate: iso(-6), endDate: iso(-4), depositAmount: 200 });  // Gite, 2 nuits
  insertRes(db, { id: 3, clientId: 1, propertyId: 2, startDate: iso(-5), endDate: iso(-1), depositAmount: 100 });  // Lodge, 4 nuits

  const { revenueByProperty, revenueTotalNights } = model.getSummary({ from: iso(-30), to: iso(0) });
  assert.deepEqual(revenueByProperty.map((p) => [p.propertyName, p.revenue, p.nights]), [
    ['Gite', 500, 5],    // sorted by revenue desc…
    ['Lodge', 100, 4],
    ['Cabane', 0, 0],    // …and the logement with no stay stays in the payload at 0
  ]);
  // The global figure is the sum of the splits, by construction.
  assert.equal(revenueTotalNights, 9);
});

test('nights ignore a tourist-tax refund — that deduction belongs to the declaration, not to occupancy', () => {
  // specs/fiscal-year-and-nights-sold.md §3.3 rule 12 vs specs/reservation-refunds.md §3.5.
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-10), endDate: iso(-6), depositAmount: 400 }); // 4 nuits
  db.prepare("INSERT INTO reservation_refunds (id, reservationId, totalTtc, method) VALUES (1, 1, 60, 'transfer')").run();
  db.prepare("INSERT INTO reservation_refund_lines (id, refundId, lineKey, amountTtc, quantity) VALUES (1, 1, 'touristTax', 6, 2)").run();

  const summary = model.getSummary({ from: iso(-30), to: iso(0) });
  const gite = summary.revenueByProperty.find((p) => p.propertyName === 'Gite');
  assert.equal(gite.nights, 4);            // the 2 refunded tax-nights do NOT come off
  assert.equal(summary.revenueTotalNights, 4);
  assert.equal(gite.revenue, 340);         // …while the refunded euros DO come off the turnover
});

test('a 0-night stay (same start and end date) contributes nothing to the nights', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-5), depositAmount: 120 });
  const summary = model.getSummary({ from: iso(-30), to: iso(0) });
  assert.equal(summary.revenueTotalNights, 0);
  assert.equal(summary.revenueByProperty.find((p) => p.propertyName === 'Gite').revenue, 120);
});

test('the three windows each carry their own nights: period, exercise-to-date, whole exercise', () => {
  const { db, model } = freshModel();
  const Y = new Date().getFullYear();
  // Closing month is December here, so the exercise IS the calendar year.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: `${Y}-01-05`, endDate: `${Y}-01-08`, depositAmount: 300 }); // past, 3 nuits
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: `${Y}-12-20`, endDate: `${Y}-12-27`, depositAmount: 700 }); // future, 7 nuits

  const summary = model.getSummary({ from: `${Y}-01-01`, to: `${Y}-01-31` });
  assert.equal(summary.revenueTotalNights, 3);                                       // January only
  assert.equal(summary.yearToDateNights, 3);                                         // …up to today
  assert.equal(summary.yearTotalNights, 10);                                         // the whole year
  assert.deepEqual(summary.yearTotalByProperty.map((p) => [p.propertyName, p.nights]), [
    ['Lodge', 7], ['Gite', 3], ['Cabane', 0],
  ]);
  // Σ per-logement nights === the global figure, on each window.
  const sum = (list) => list.reduce((s, p) => s + p.nights, 0);
  assert.equal(sum(summary.revenueByProperty), summary.revenueTotalNights);
  assert.equal(sum(summary.yearToDateByProperty), summary.yearToDateNights);
  assert.equal(sum(summary.yearTotalByProperty), summary.yearTotalNights);
});

test('a devis never contributes nights (kind filter holds)', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-10), endDate: iso(-6), depositAmount: 400 });
  db.prepare("UPDATE reservations SET kind = 'devis' WHERE id = 1").run();
  assert.equal(model.getSummary({ from: iso(-30), to: iso(0) }).revenueTotalNights, 0);
});
