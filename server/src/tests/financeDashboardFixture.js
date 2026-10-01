// Shared fixture of the finance dashboard suites (specs/finance-dashboard-redesign.md): an in-memory
// schema holding just the columns the finance models read, plus closures and refunds. Not a test file.

const Database = require('better-sqlite3');
const financeModel = require('../models/financeModel');
const dashboardModel = require('../models/financeDashboardModel');

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10, fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12, revenueGoals TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    requestOrigin TEXT, attributionChannel TEXT, devisStatus TEXT, createdAt TEXT DEFAULT (datetime('now')),
    finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0,
    depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
    depositPaidCash INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT, balanceDueDate TEXT, balancePaidCash INTEGER DEFAULT 0,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT, complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
    endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0,
    midStaySettledNotes TEXT,
    platformCommissionAmount REAL, acompteCommissionAmount REAL
  );
  CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, startDate TEXT NOT NULL, endDate TEXT NOT NULL);
  CREATE TABLE reservation_refunds (id INTEGER PRIMARY KEY, reservationId INTEGER, refundDate TEXT, method TEXT, totalTtc REAL, reason TEXT, createdAt TEXT);
`;

const THIS_YEAR = new Date().getFullYear();
const TODAY = new Date().toISOString().slice(0, 10);

function freshDb({ closingMonth = 12, properties = ['Gite', 'Tente', 'Yourte'] } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, vatRate, fiscalYearEndMonth) VALUES (1, 10, ?)').run(closingMonth);
  properties.forEach((name, i) => db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)').run(i + 1, name));
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return {
    db,
    finance: financeModel.buildModel(db),
    dashboard: dashboardModel.buildModel(db),
  };
}

let nextId = 1;
function insert(db, r) {
  const row = {
    id: nextId++, kind: 'reservation', clientId: 1, propertyId: 1, platform: 'direct',
    requestOrigin: null, attributionChannel: null, balanceAmount: 0, ...r,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
  return row.id;
}

const sum = (list, key) => Math.round(list.reduce((n, x) => n + (typeof key === 'function' ? key(x) : x[key]), 0) * 100) / 100;

module.exports = { freshDb, insert, sum, THIS_YEAR, TODAY };
