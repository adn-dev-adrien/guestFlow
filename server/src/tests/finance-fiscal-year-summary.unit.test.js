const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/fiscal-year-and-nights-sold.md §3.1-§3.5 — getSummary read through a NON-calendar exercise
// (closing September ⇒ 1 Oct … 30 Sep), attributed by the solde payment date, with the nights sold
// per logement and the exercise selector's options.
const financeModel = require('../models/financeModel');

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10, fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0,
    depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT, balanceDueDate TEXT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0, endOfStayComplementPaidCash INTEGER DEFAULT 0,
    midStaySettledNotes TEXT,
    platformCommissionAmount REAL, acompteCommissionAmount REAL
  );
`;

// « Today » is the real clock (the model reads it), so the fixtures are anchored on it: the exercise
// under test is always the CURRENT one, and « past » / « future » are relative to now.
const TODAY = new Date().toISOString().split('T')[0];
function shift(days, base = TODAY) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}
// Closing month such that today sits comfortably INSIDE the exercise, never on a boundary: close the
// books 6 months from now, so the exercise started ~6 months ago and ends ~6 months out.
const CLOSING_MONTH = ((new Date(`${TODAY}T00:00:00Z`).getUTCMonth() + 6) % 12) + 1;

function freshModel({ closingMonth = CLOSING_MONTH } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, vatRate, fiscalYearEndMonth) VALUES (1, 10, ?)').run(closingMonth);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont'), (2, 'Marie', 'Martin')").run();
  return { db, model: financeModel.buildModel(db) };
}

const COLS = [
  'id', 'clientId', 'propertyId', 'startDate', 'endDate', 'platform', 'finalPrice', 'touristTaxTotal',
  'depositAmount', 'depositPaid', 'balanceAmount', 'balancePaid', 'balancePaidDate',
];
const insertRes = (db, r) => db.prepare(
  `INSERT INTO reservations (${COLS.join(', ')}) VALUES (${COLS.map((c) => `@${c}`).join(', ')})`,
).run({
  platform: 'direct', finalPrice: 0, touristTaxTotal: 0,
  depositAmount: 0, depositPaid: 0, balanceAmount: 0, balancePaid: 0, balancePaidDate: null,
  ...r,
});

// ── the exercise itself ──────────────────────────────────────────────────────────────────

test('getSummary reports the CURRENT exercise, bounded by the closing month', () => {
  const { model } = freshModel({ closingMonth: 9 });
  const { fiscalYear } = model.getSummary({});
  assert.equal(fiscalYear.from.slice(5), '10-01');  // 1 October
  assert.equal(fiscalYear.to.slice(5), '09-30');    // 30 September
  assert.equal(fiscalYear.label, `${fiscalYear.key - 1}-${fiscalYear.key}`);
  assert.equal(fiscalYear.isCurrent, true);
});

test('a December closing month keeps the pre-spec behaviour: the exercise is the calendar year', () => {
  const { model } = freshModel({ closingMonth: 12 });
  const { fiscalYear } = model.getSummary({});
  const Y = new Date().getFullYear();
  assert.deepEqual(
    { from: fiscalYear.from, to: fiscalYear.to, label: fiscalYear.label },
    { from: `${Y}-01-01`, to: `${Y}-12-31`, label: String(Y) },
  );
});

// ── attribution: the solde payment date, not the departure ───────────────────────────────

test('a stay leaving AFTER the closing but settled BEFORE it counts in the closing exercise', () => {
  const { db, model } = freshModel({ closingMonth: 9 });
  const exercise = model.getSummary({}).fiscalYear;
  // Departure 3 days into the NEXT exercise, solde collected 2 days before the closing.
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1,
    startDate: shift(-2, exercise.to), endDate: shift(3, exercise.to),
    finalPrice: 850, balanceAmount: 850, balancePaid: 1, balancePaidDate: shift(-2, exercise.to),
  });

  const closing = model.getSummary({ fiscalYear: exercise.key });
  const next = model.getSummary({ fiscalYear: exercise.key + 1 });
  // The WHOLE stay — money and its 5 nights — lands in the exercise of the payment (rule 7).
  assert.equal(closing.yearTotal, 850);
  assert.equal(closing.yearTotalNights, 5);
  assert.equal(next.yearTotal, 0);
  assert.equal(next.yearTotalNights, 0);
});

test('an unsettled stay is attributed to its departure date', () => {
  const { db, model } = freshModel({ closingMonth: 9 });
  const exercise = model.getSummary({}).fiscalYear;
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1,
    startDate: shift(-2, exercise.to), endDate: shift(3, exercise.to),
    finalPrice: 850, balanceAmount: 850, balancePaid: 0,
  });
  assert.equal(model.getSummary({ fiscalYear: exercise.key }).yearTotal, 0);
  assert.equal(model.getSummary({ fiscalYear: exercise.key + 1 }).yearTotal, 850);
});

test('the du/au period follows the attribution date too (rule 8)', () => {
  const { db, model } = freshModel();
  // Stay departing in 40 days but already settled today → it belongs to TODAY's period.
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: shift(38), endDate: shift(40),
    finalPrice: 600, balanceAmount: 600, balancePaid: 1, balancePaidDate: TODAY,
  });
  assert.equal(model.getSummary({ from: shift(-1), to: shift(1) }).revenueTotal, 600);
  assert.equal(model.getSummary({ from: shift(39), to: shift(41) }).revenueTotal, 0);
});

// ── « depuis le début de l'exercice » vs « sur l'exercice » ───────────────────────────────

test('yearToDate stops at today while yearTotal covers the whole exercise', () => {
  const { db, model } = freshModel();
  const exercise = model.getSummary({}).fiscalYear;
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: shift(-12), endDate: shift(-10), finalPrice: 400, depositAmount: 400 });
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: shift(10), endDate: shift(13), finalPrice: 700, depositAmount: 700 });
  const summary = model.getSummary({ fiscalYear: exercise.key });

  assert.equal(summary.yearToDate, 400);        // the past stay only
  assert.equal(summary.yearToDateNights, 2);
  assert.equal(summary.yearTotal, 1100);        // both
  assert.equal(summary.yearTotalNights, 5);
});

test('on a CLOSED exercise both figures are equal — the exercise is entirely in the past', () => {
  const { db, model } = freshModel();
  const previous = model.getSummary({}).fiscalYear.key - 1;
  const bounds = model.getSummary({ fiscalYear: previous }).fiscalYear;
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: shift(-3, bounds.to), endDate: bounds.to, finalPrice: 900, depositAmount: 900 });

  const summary = model.getSummary({ fiscalYear: previous });
  assert.equal(summary.yearTotal, 900);
  assert.equal(summary.yearToDate, 900);
  assert.equal(summary.yearToDateNights, summary.yearTotalNights);
});

test('on a FUTURE exercise « depuis le début » is empty while the total already counts', () => {
  const { db, model } = freshModel();
  const nextKey = model.getSummary({}).fiscalYear.key + 1;
  const bounds = model.getSummary({ fiscalYear: nextKey }).fiscalYear;
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: bounds.from, endDate: shift(4, bounds.from), finalPrice: 500, depositAmount: 500 });

  const summary = model.getSummary({ fiscalYear: nextKey });
  assert.equal(summary.yearTotal, 500);
  assert.equal(summary.yearTotalNights, 4);
  assert.equal(summary.yearToDate, 0);
  assert.equal(summary.yearToDateNights, 0);
});

// ── selecting an exercise ────────────────────────────────────────────────────────────────

test('no fiscalYear param → the current exercise; an invalid one → the current exercise too', () => {
  const { model } = freshModel();
  const current = model.getSummary({}).fiscalYear.key;
  for (const key of ['', 'abc', 0, null, undefined, 1999]) {
    assert.equal(model.getSummary({ fiscalYear: key }).fiscalYear.key, current, `key=${String(key)}`);
  }
});

test('an explicitly selected past exercise is reported as not-current', () => {
  const { model } = freshModel();
  const current = model.getSummary({}).fiscalYear.key;
  const past = model.getSummary({ fiscalYear: current - 2 }).fiscalYear;
  assert.equal(past.key, current - 2);
  assert.equal(past.isCurrent, false);
});

test('fiscalYears lists every exercise touched by the data, newest first, current flagged', () => {
  const { db, model } = freshModel();
  const current = model.getSummary({}).fiscalYear;
  const previousBounds = model.getSummary({ fiscalYear: current.key - 1 }).fiscalYear;
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: shift(-3, previousBounds.to), endDate: previousBounds.to, depositAmount: 100 });
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: shift(-3), endDate: shift(-1), depositAmount: 100 });

  const { fiscalYears } = model.getSummary({});
  assert.deepEqual(fiscalYears.map((f) => f.key), [current.key, current.key - 1]);
  assert.deepEqual(fiscalYears.map((f) => f.isCurrent), [true, false]);
});

test('fiscalYears on an empty database still offers the current exercise', () => {
  const { model } = freshModel();
  const { fiscalYear, fiscalYears } = model.getSummary({});
  assert.deepEqual(fiscalYears.map((f) => f.key), [fiscalYear.key]);
});

// ── the operational section is NOT re-attributed (rule 9) ────────────────────────────────

test('« réservations à venir » still keys on the real stay dates, not on the payment', () => {
  const { db, model } = freshModel();
  // Fully settled today, but the guest arrives next month: it must stay in « à venir ».
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: shift(30), endDate: shift(34),
    finalPrice: 600, balanceAmount: 600, balancePaid: 1, balancePaidDate: TODAY,
  });
  const upcoming = model.getOperational().upcoming.reservations;
  assert.deepEqual(upcoming.map((r) => r.id), [1]);
  assert.equal(upcoming[0].nights, 4);
});
