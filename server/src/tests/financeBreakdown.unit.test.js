const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/finance-card-breakdown.md — getBreakdown returns the reservations behind a single card figure,
// with one amount column whose Σ equals the card. The coherence guarantee (rule 4): for the same window,
// getBreakdown(metric).total === getSummary()[metric].
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
    platformCommissionAmount REAL, acompteCommissionAmount REAL
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

const sumAmounts = (rows) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

// ── rule 4: coherence with getSummary, per metric ───────────────────────────────────────

test('getBreakdown(revenueTotal): rows = all period stays; Σ amount === total === summary.revenueTotal', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 150, balanceAmount: 350 });
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), depositAmount: 60, balanceAmount: 140 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  const bd = model.getBreakdown({ metric: 'revenueTotal', from: iso(0), to: iso(10) });
  assert.ok(bd.ok);
  assert.deepEqual(bd.data.rows.map((r) => r.id), [1, 2]);
  assert.equal(sumAmounts(bd.data.rows), bd.data.total);
  assert.equal(bd.data.total, summary.revenueTotal);
  assert.equal(bd.data.column, 'Total de séjour');
  assert.equal(bd.data.window.kind, 'period');
});

test('getBreakdown(revenueTotal): per-row amount + total are NET of the platform commission', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), platform: 'airbnb', depositAmount: 0, balanceAmount: 300, platformCommissionAmount: 50 }); // 300 − 50 = 250
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), platform: 'direct', depositAmount: 60, balanceAmount: 140 }); // 200 (direct)
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  const bd = model.getBreakdown({ metric: 'revenueTotal', from: iso(0), to: iso(10) });
  const byId = Object.fromEntries(bd.data.rows.map((r) => [r.id, r.amount]));
  assert.equal(byId[1], 250); // platform, net of commission
  assert.equal(byId[2], 200); // direct, unchanged
  assert.equal(sumAmounts(bd.data.rows), bd.data.total);
  assert.equal(bd.data.total, summary.revenueTotal); // breakdown reconciles with the card
  assert.equal(bd.data.total, 450);
});

test('getBreakdown(totalCollected): omits rows with no collected amount; total === summary.totalCollected', () => {
  const { db, model } = freshModel();
  // Deposit paid (counts), balance unpaid; caisse-interne complement excluded from compta.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 150, depositPaid: 1, balanceAmount: 350, complementAmount: 50, complementPaid: 1, complementPaidCash: 1 });
  // Nothing paid → collected 0 → omitted from the list.
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), depositAmount: 100, balanceAmount: 200 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  const bd = model.getBreakdown({ metric: 'totalCollected', from: iso(0), to: iso(10) });
  assert.deepEqual(bd.data.rows.map((r) => r.id), [1]);
  assert.equal(bd.data.rows[0].amount, 150);
  assert.equal(sumAmounts(bd.data.rows), bd.data.total);
  assert.equal(bd.data.total, summary.totalCollected);
  assert.equal(bd.data.column, 'Encaissé');
});

test('getBreakdown(totalPending): only PAST + non-settled; total === summary.totalPending', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), depositAmount: 100, balanceAmount: 200 }); // past unpaid → pending 300
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), depositAmount: 100, balanceAmount: 200 });   // future → excluded
  insertRes(db, { id: 3, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-3), depositAmount: 100, depositPaid: 1, balanceAmount: 50, balancePaid: 1 }); // past settled → excluded
  const summary = model.getSummary({ from: iso(-10), to: iso(10) });
  const bd = model.getBreakdown({ metric: 'totalPending', from: iso(-10), to: iso(10) });
  assert.deepEqual(bd.data.rows.map((r) => r.id), [1]);
  assert.equal(sumAmounts(bd.data.rows), bd.data.total);
  assert.equal(bd.data.total, summary.totalPending);
  assert.equal(bd.data.total, 300);
});

// specs/finance-pending-global-remaining.md — the totalPending breakdown is PERIOD-FREE (window
// 'global') and each row carries its RESTANT DÛ, mirroring the reworked getSummary figure.
test('getBreakdown(totalPending): ignores from/to (global window) + rows carry the restant dû', () => {
  const { db, model } = freshModel();
  // Finished before the requested window, partially paid: deposit 100 paid, balance 200 unpaid.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-40), endDate: iso(-35), depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 0 });
  const summary = model.getSummary({ from: iso(-10), to: iso(10) });
  const bd = model.getBreakdown({ metric: 'totalPending', from: iso(-10), to: iso(10) });
  assert.equal(bd.data.window.kind, 'global');
  assert.deepEqual(bd.data.rows.map((r) => r.id), [1], 'finished stay outside the period still listed');
  assert.equal(bd.data.rows[0].amount, 200, 'row amount = restant dû, not the whole stay');
  assert.equal(bd.data.total, summary.totalPending);
  assert.equal(bd.data.total, 200);
});

test('getBreakdown(yearToDate / yearTotal): year window, total === summary figure (from/to ignored)', () => {
  const { db, model } = freshModel();
  const Y = new Date().getFullYear();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: `${Y}-01-02`, endDate: `${Y}-01-05`, depositAmount: 100 });
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: `${Y}-12-20`, endDate: `${Y}-12-25`, depositAmount: 100 });
  const summary = model.getSummary({ from: `${Y}-01-01`, to: `${Y}-12-31` });

  // Pass a deliberately narrow period — annual metrics must ignore it and use the calendar year.
  const ytd = model.getBreakdown({ metric: 'yearToDate', from: iso(0), to: iso(1) });
  const yt = model.getBreakdown({ metric: 'yearTotal', from: iso(0), to: iso(1) });
  assert.equal(ytd.data.window.kind, 'year');
  assert.equal(ytd.data.window.year, Y);
  const expectedYtdIds = [1, 2].filter((id) => (id === 1 ? `${Y}-01-05` : `${Y}-12-25`) <= TODAY);
  assert.deepEqual(ytd.data.rows.map((r) => r.id), expectedYtdIds);
  assert.equal(ytd.data.total, summary.yearToDate);
  assert.equal(sumAmounts(ytd.data.rows), ytd.data.total);

  assert.deepEqual(yt.data.rows.map((r) => r.id), [1, 2]);
  assert.equal(yt.data.total, summary.yearTotal);
  assert.equal(yt.data.total, 200);
});

// ── row shape, HT, edge & validation ────────────────────────────────────────────────────

test('getBreakdown: each row carries client/property/platform/dates + element-by-element HT', () => {
  const { db, model } = freshModel();
  // 1100 accommodation + 100 tourist tax → 1200 TTC, 1000 HT (tax bears no VAT).
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(3), platform: 'Airbnb', finalPrice: 1100, touristTaxTotal: 100, depositAmount: 1200 });
  const bd = model.getBreakdown({ metric: 'revenueTotal', from: iso(0), to: iso(10) });
  const row = bd.data.rows[0];
  assert.equal(row.clientName, 'Jean Dupont');
  assert.equal(row.propertyName, 'Gite');
  assert.equal(row.platform, 'Airbnb');
  assert.equal(row.amount, 1200);
  assert.equal(row.amountHt, 1000);
  assert.equal(bd.data.totalHt, 1000);
});

test('getBreakdown: empty set → ok with empty rows and 0 totals', () => {
  const { model } = freshModel();
  const bd = model.getBreakdown({ metric: 'revenueTotal', from: iso(0), to: iso(10) });
  assert.ok(bd.ok);
  assert.deepEqual(bd.data.rows, []);
  assert.equal(bd.data.total, 0);
  assert.equal(bd.data.totalHt, 0);
});

test('getBreakdown: a kind=devis row never leaks into the breakdown', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 500 });
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, depositAmount) VALUES (99, 'devis', 1, 1, ?, ?, 9999)").run(iso(1), iso(4));
  const bd = model.getBreakdown({ metric: 'revenueTotal', from: iso(0), to: iso(10) });
  assert.deepEqual(bd.data.rows.map((r) => r.id), [1]);
});

test('getBreakdown: unknown metric → 400', () => {
  const { model } = freshModel();
  const bd = model.getBreakdown({ metric: 'nope', from: iso(0), to: iso(10) });
  assert.equal(bd.ok, false);
  assert.equal(bd.status, 400);
});
