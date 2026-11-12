// specs/resource-booking-pricing-and-invoicing.md rule 21 and specs/plugins-phase-3c-hourly-resources.md rule 17
// (R35-P1) — the erase warning tells a sale of the accounting export from a « Payé » that is in no ledger: the erase
// takes the first out of every month re-exported.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const plugin = require('..');
const { createTables, bookingsV2, bookingsV5 } = require('../migrations');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

test.afterEach(() => registry.reset());

test('rule 21 — journaled sales are announced as leaving the accounting export, the rest as outside the books', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY); CREATE TABLE clients (id INTEGER PRIMARY KEY); CREATE TABLE reservations (id INTEGER PRIMARY KEY);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, priceType TEXT, price REAL DEFAULT 0, isComplex INTEGER DEFAULT 0);
  `);
  db.prepare("INSERT INTO resources (id, name, priceType) VALUES (2, 'Bain fictif', 'per_hour')").run();
  createTables(db);
  bookingsV2(db);
  bookingsV5(db);
  const card = JSON.stringify([{ method: 'card', amountCents: 5000, internal: false }]);
  const caisse = JSON.stringify([{ method: 'cash', amountCents: 3000, internal: true }]);
  db.prepare(`INSERT INTO resource_bookings (resourceId, date, startTime, endTime, totalPrice, paid, paidAt, paymentRecordedAt, paymentTenders) VALUES
    (2, @d1, '18:00', '19:00', 50, 1, @d1, @d1, @card),
    (2, @d2, '18:00', '19:00', 30, 1, @d2, @d2, @caisse),
    (2, @d3, '18:00', '19:00', 90, 1, @d3, NULL, NULL),
    (2, @d4, '18:00', '19:00', 40, 0, NULL, NULL, NULL)`).run({ card, caisse, d1: `${Y}-03-01`, d2: `${Y}-03-02`, d3: `${Y}-03-03`, d4: `${Y}-03-04` });
  registry.configure({ isActive: () => true, allows: () => true });
  plugin.register(createContext(plugin.id, { db }));
  const lines = registry.get(plugin.id).data.describe(db);
  assert.deepEqual(lines.slice(0, 3), [
    { label: '1 réservation hors séjour, 50,00 € encaissés, retirés de l’export comptable', count: 1, warning: true },
    { label: '2 réservations hors séjour, 120,00 € encaissés, absents de la compta', count: 2, warning: true },
    { label: '1 réservation hors séjour', count: 1 },
  ]);
});
