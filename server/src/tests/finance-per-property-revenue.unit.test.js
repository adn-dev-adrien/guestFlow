const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/finance-per-property-revenue-chart.md — per-logement chart windows: `yearToDateByProperty`
// (Σ total de séjour, Jan 1 → today, filtered by property) plus `revenueByProperty` enriched with
// `revenueHt`. Both are seeded from the properties table (a logement with no reservation appears at
// 0 in the payload) and sorted revenue desc, ties broken by name.
const financeModel = require('../models/financeModel');

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0,
    depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balanceDueDate TEXT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT, complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
    endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0,
    midStaySettledNotes TEXT,
    platformCommissionAmount REAL, acompteCommissionAmount REAL
  );
`;

function iso(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().split('T')[0];
}
const TODAY = new Date().toISOString().split('T')[0];
const round2 = (n) => Math.round(n * 100) / 100;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Tente')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont'), (2, 'Marie', 'Martin')").run();
  return { db, model: financeModel.buildModel(db) };
}

const COLS = [
  'id', 'clientId', 'propertyId', 'startDate', 'endDate', 'platform', 'finalPrice', 'touristTaxTotal',
  'depositAmount', 'depositPaid', 'depositDueDate', 'depositDisabled',
  'balanceAmount', 'balancePaid', 'balanceDueDate',
  'complementAmount', 'complementPaid', 'complementPaidCash',
  'endOfStayComplementAmount', 'endOfStayComplementPaid', 'endOfStayComplementPaidCash',
  'platformCommissionAmount', 'acompteCommissionAmount',
];
const insertRes = (db, r) => db.prepare(
  `INSERT INTO reservations (${COLS.join(', ')}) VALUES (${COLS.map((c) => `@${c}`).join(', ')})`,
).run({
  platform: 'direct', finalPrice: 0, touristTaxTotal: 0,
  depositAmount: 0, depositPaid: 0, depositDueDate: null, depositDisabled: 0,
  balanceAmount: 0, balancePaid: 0, balanceDueDate: null,
  complementAmount: 0, complementPaid: 0, complementPaidCash: 0,
  endOfStayComplementAmount: 0, endOfStayComplementPaid: 0, endOfStayComplementPaidCash: 0,
  platformCommissionAmount: null, acompteCommissionAmount: null,
  ...r,
});

// ── revenueByProperty (period) — HT + zero-seeding ─────────────────────────────────────

test('revenueByProperty: per-logement revenue + HT, zero-revenue logement seeded at 0 €', () => {
  const { db, model } = freshModel();
  // Gite, direct, no tourist tax: 150 + 400 = 550 TTC → HT = 550 ÷ 1.1 = 500.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), finalPrice: 550, depositAmount: 150, balanceAmount: 400 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.deepEqual(summary.revenueByProperty, [
    { propertyId: 1, propertyName: 'Gite', revenue: 550, revenueHt: 500 },
    { propertyId: 2, propertyName: 'Tente', revenue: 0, revenueHt: 0 },
  ]);
});

test('revenueByProperty: net of commission, caisse interne excluded, tourist tax not HT — per logement', () => {
  const { db, model } = freshModel();
  // Gite (airbnb): acompte 100 + solde 300 − commissions (10 + 30) = 360; the 50 € complement is
  // caisse interne → excluded, exactly like the global cards. No tax → HT = 360 ÷ 1.1.
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), platform: 'airbnb',
    finalPrice: 400, depositAmount: 100, balanceAmount: 300,
    acompteCommissionAmount: 10, platformCommissionAmount: 30,
    complementAmount: 50, complementPaidCash: 1,
  });
  // Tente (direct): solde 220 = 200 accommodation + 20 tourist tax → HT = 200 ÷ 1.1 (tax bears no VAT).
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(1), endDate: iso(5), finalPrice: 200, touristTaxTotal: 20, balanceAmount: 220 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  const gite = summary.revenueByProperty.find((p) => p.propertyId === 1);
  const tente = summary.revenueByProperty.find((p) => p.propertyId === 2);
  assert.equal(gite.revenue, 360);
  assert.equal(gite.revenueHt, round2(360 / 1.1));
  assert.equal(tente.revenue, 220);
  assert.equal(tente.revenueHt, round2(200 / 1.1));
  // Per-logement figures always sum to the matching global card.
  assert.equal(round2(gite.revenue + tente.revenue), summary.revenueTotal);
});

test('revenueByProperty: sorted revenue desc, ties broken by name asc', () => {
  const { db, model } = freshModel();
  db.prepare("INSERT INTO properties (id, name) VALUES (3, 'Cabane')").run();
  // Tente and Cabane tie at 100 → alphabetical (Cabane first); Gite at 0 → last.
  insertRes(db, { id: 1, clientId: 1, propertyId: 2, startDate: iso(1), endDate: iso(4), balanceAmount: 100 });
  insertRes(db, { id: 2, clientId: 2, propertyId: 3, startDate: iso(1), endDate: iso(4), balanceAmount: 100 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.deepEqual(summary.revenueByProperty.map((p) => p.propertyName), ['Cabane', 'Tente', 'Gite']);
});

// ── yearToDateByProperty (Jan 1 → today) ───────────────────────────────────────────────

test('yearToDateByProperty: Σ total-de-séjour per logement, endDate ≤ today only', () => {
  const { db, model } = freshModel();
  const Y = new Date().getFullYear();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: `${Y}-01-02`, endDate: `${Y}-01-05`, depositAmount: 100 }); // early this year
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: `${Y}-12-20`, endDate: `${Y}-12-25`, depositAmount: 80 }); // late this year
  const summary = model.getSummary({ from: `${Y}-01-01`, to: `${Y}-12-31` });
  const gite = summary.yearToDateByProperty.find((p) => p.propertyId === 1);
  const tente = summary.yearToDateByProperty.find((p) => p.propertyId === 2);
  // Same conditional pattern as the year-cards test: a stay counts only once its endDate has passed.
  assert.equal(gite.revenue, `${Y}-01-05` <= TODAY ? 100 : 0);
  assert.equal(tente.revenue, `${Y}-12-25` <= TODAY ? 80 : 0);
  assert.equal(summary.yearToDateByProperty.length, 2); // every logement present (seeded)
  assert.equal(round2(gite.revenue + tente.revenue), summary.yearToDate); // split sums to the global card
});

test('yearToDateByProperty ignores the du/au period (annual window)', () => {
  const { db, model } = freshModel();
  const Y = new Date().getFullYear();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: `${Y}-01-02`, endDate: `${Y}-01-05`, depositAmount: 100 });
  // A period that excludes the reservation entirely: the year figure keeps it, the period one drops it.
  const summary = model.getSummary({ from: iso(5), to: iso(10) });
  const gite = summary.yearToDateByProperty.find((p) => p.propertyId === 1);
  assert.equal(gite.revenue, `${Y}-01-05` <= TODAY ? 100 : 0);
  assert.ok(summary.revenueByProperty.every((p) => p.revenue === 0));
});
