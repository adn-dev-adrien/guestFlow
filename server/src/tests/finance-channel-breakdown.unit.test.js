const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/site-traffic-analytics.md rules 21-23 — « Canaux de réservation »: one row per platform, the
// website split by source, and « Direct (saisie) »; website rows carry requests + conversion; and the
// card's total is the per-logement chart's total for the same window (rule 22).
const financeModel = require('../models/financeModel');

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    requestOrigin TEXT, attributionChannel TEXT, devisStatus TEXT, createdAt TEXT DEFAULT (datetime('now')),
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

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Tente')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { db, model: financeModel.buildModel(db) };
}

let nextId = 1;
function insert(db, r) {
  const row = {
    id: nextId++, kind: 'reservation', clientId: 1, propertyId: 1, platform: 'direct',
    requestOrigin: null, attributionChannel: null, devisStatus: null,
    startDate: iso(1), endDate: iso(3), depositAmount: 0, balanceAmount: 0, ...r,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
}

function seed(db) {
  insert(db, { platform: 'Airbnb', depositAmount: 200, balanceAmount: 300 });
  insert(db, { platform: 'Lodgify', propertyId: 2, balanceAmount: 300 });
  insert(db, { requestOrigin: 'public', attributionChannel: 'social', balanceAmount: 400, finalPrice: 440 });
  insert(db, { requestOrigin: 'public', attributionChannel: null, propertyId: 2, balanceAmount: 200 });
  // Website requests of the window: two from social (one became a booking), one from search.
  insert(db, { kind: 'devis', requestOrigin: 'public', attributionChannel: 'social', devisStatus: 'converted' });
  insert(db, { kind: 'devis', requestOrigin: 'public', attributionChannel: 'social', devisStatus: 'draft' });
  insert(db, { kind: 'devis', requestOrigin: 'public', attributionChannel: 'search', devisStatus: 'draft' });
  // A back-office devis is not a website request.
  insert(db, { kind: 'devis', devisStatus: 'draft' });
}

const pick = (rows) => rows.map(({ key, group, label, reservations, nights, revenue, requests, converted, conversionRate }) => (
  { key, group, label, reservations, nights, revenue, requests, converted, conversionRate }));

// Lodgify counted as a direct sale, as productisation_v1 sets it on Solio (specs/plugins-phase-p-productisation.md rule 19).
require('../utils/platformNameFormat').setDirectChannels(['lodgify']);

test('revenueByChannel: the website by source, then platforms and manual direct, each sorted by revenue', () => {
  const { db, model } = freshModel();
  seed(db);
  const { site, others, total } = model.getSummary({ from: iso(0), to: iso(30) }).revenueByChannel;
  assert.deepEqual(pick(site.rows), [
    { key: 'site:social', group: 'site', label: 'Réseaux sociaux', reservations: 1, nights: 2, revenue: 400, requests: 2, converted: 1, conversionRate: 50 },
    { key: 'site:unknown', group: 'site', label: 'Origine inconnue', reservations: 1, nights: 2, revenue: 200, requests: 0, converted: 0, conversionRate: null },
    { key: 'site:search', group: 'site', label: 'Recherche', reservations: 0, nights: 0, revenue: 0, requests: 1, converted: 0, conversionRate: 0 },
  ]);
  assert.deepEqual(site.subtotal, { reservations: 2, nights: 4, revenue: 600, revenueHt: 363.64, requests: 3, converted: 1, conversionRate: 33.3 });
  assert.deepEqual(pick(others), [
    { key: 'platform:airbnb', group: 'platform', label: 'Airbnb', reservations: 1, nights: 2, revenue: 500, requests: undefined, converted: undefined, conversionRate: undefined },
    { key: 'direct', group: 'direct', label: 'Direct (saisie)', reservations: 1, nights: 2, revenue: 300, requests: undefined, converted: undefined, conversionRate: undefined },
  ]);
  assert.equal(total.revenue, 1400);
  assert.equal(total.reservations, 4);
});

test('rule 22 — the channel total equals the per-logement total, period and exercise', () => {
  const { db, model } = freshModel();
  seed(db);
  // A stay already over, so « depuis le début de l'exercice » has something to count too.
  insert(db, { platform: 'Booking', startDate: iso(-4), endDate: iso(-1), balanceAmount: 250 });
  const sum = (rows) => Math.round(rows.reduce((a, r) => a + r.revenue, 0) * 100) / 100;
  const summary = model.getSummary({ from: iso(-10), to: iso(30) });
  assert.equal(summary.revenueByChannel.total.revenue, sum(summary.revenueByProperty));
  assert.equal(summary.revenueByChannel.total.revenue, summary.revenueTotal);
  assert.equal(summary.yearToDateByChannel.total.revenue, sum(summary.yearToDateByProperty));
});

test('an empty window returns no channel row', () => {
  const { model } = freshModel();
  const summary = model.getSummary({ from: iso(0), to: iso(30) });
  assert.deepEqual(summary.revenueByChannel.site.rows, []);
  assert.deepEqual(summary.revenueByChannel.others, []);
  assert.equal(summary.revenueByChannel.total.revenue, 0);
});
