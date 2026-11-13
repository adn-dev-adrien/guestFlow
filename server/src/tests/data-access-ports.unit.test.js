// specs/pricing-components.md §3 rules 11 and 48 — the data-access ports: CatalogueProvider (the per-property override
// of an option exists once), StayRepository and PaymentLedger read exactly what the loader and the engine read today.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const catalogueProvider = require('../models/ports/catalogueProvider');
const stayRepository = require('../models/ports/stayRepository');
const paymentLedger = require('../models/ports/paymentLedger');
const pricing = require('../utils/pricing');

function catalogueDb({ withOverrides = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, price REAL, priceType TEXT);
    CREATE TABLE property_options (optionId INTEGER, propertyId INTEGER);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, price REAL, priceType TEXT);
    INSERT INTO options VALUES (1, 'Linge', 10, 'per_person'), (2, 'Bois', 5, 'per_stay');
    INSERT INTO property_options VALUES (1, 7), (2, 8);
    INSERT INTO resources VALUES (1, 'Bain', 30, 'per_hour');
  `);
  if (withOverrides) {
    db.exec(`
      CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, freeUnits INTEGER DEFAULT 0);
      CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER);
      INSERT INTO property_option_prices VALUES (7, 1, 12, 2);
      INSERT INTO property_resource_prices VALUES (7, 1, 35, 60);
    `);
  }
  return db;
}

test('rule 11 — the engine\'s catalogue readers are the port\'s: one definition', () => {
  assert.equal(pricing.getApplicableOptions, catalogueProvider.getApplicableOptions);
  assert.equal(pricing.getApplicableResources, catalogueProvider.getApplicableResources);
});

test('rule 11 — applicableOptions: the lodging\'s override wins, and only the lodging\'s options come back', () => {
  const catalogue = catalogueProvider.create(catalogueDb());
  const options = catalogue.applicableOptions(7);
  assert.deepEqual(options.map((o) => [o.id, o.price, o.freeUnits]), [[1, 12, 2]]);
  assert.deepEqual(catalogue.applicableOptions(8).map((o) => [o.id, o.price, o.freeUnits]), [[2, 5, 0]]);
});

test('rule 11 — applicableResources: the lodging\'s price and free minutes', () => {
  const catalogue = catalogueProvider.create(catalogueDb());
  assert.deepEqual(catalogue.applicableResources(7).map((r) => [r.id, r.price, r.freeMinutes]), [[1, 35, 60]]);
  assert.deepEqual(catalogue.applicableResources(8).map((r) => [r.id, r.price, r.freeMinutes]), [[1, 30, 0]]);
});

test('rule 11 — optionPriceOverride: the row, undefined without one, undefined on a schema without the table', () => {
  const catalogue = catalogueProvider.create(catalogueDb());
  assert.deepEqual(catalogue.optionPriceOverride(1, '7'), { price: 12 });
  assert.equal(catalogue.optionPriceOverride(1, 8), undefined);
  assert.equal(catalogueProvider.create(catalogueDb({ withOverrides: false })).optionPriceOverride(1, 7), undefined);
});

test('rule 11 — no other module queries property_option_prices for a unit price outside the port, the options model and the engine\'s own reader', () => {
  const reservationsModel = fs.readFileSync(path.join(__dirname, '..', 'models', 'reservationsModel.js'), 'utf8');
  assert.doesNotMatch(reservationsModel, /FROM property_option_prices/);
});

function stayDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT, tariffSnapshot TEXT);
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT,
      totalPrice REAL, offered INTEGER, inComplement INTEGER, acompteContribTtc REAL, soldeContribTtc REAL, cardPersons INTEGER);
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER,
      inComplement INTEGER, acompteContribTtc REAL, soldeContribTtc REAL, sortOrder INTEGER);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT,
      totalPrice REAL, offered INTEGER, inComplement INTEGER, acompteContribTtc REAL, soldeContribTtc REAL);
    CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
    INSERT INTO reservations VALUES (1, 7, '2027-06-10', '2027-06-12', '{"extraGuestPriceUnit":"per_night"}'), (2, 7, '2027-06-10', '2027-06-12', NULL); -- date-literal-ok: seeded stay, nothing compares with today
    INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, cardPersons) VALUES (1, 5, 2, 10, 4, 'per_person', 40, NULL, 3);
    INSERT INTO reservation_custom_options VALUES (9, 1, 'Extra', 15, NULL, NULL, NULL, NULL, 0);
    INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (1, 3, 1, 30, 1, 'per_hour', 30);
    INSERT INTO reservation_nights VALUES (1, '2027-06-11', 'Haute', 'season', 140), (1, '2027-06-10', 'Haute', 'season', 140); -- date-literal-ok: seeded nights
  `);
  return db;
}

test('rule 48 — StayRepository reads the stay and its lines as the engine input did', () => {
  const stays = stayRepository.create(stayDb());
  assert.equal(stays.stayRow('1').propertyId, 7);
  assert.equal(stays.stayRow(404), undefined);
  assert.deepEqual(stays.optionRows(1), [{ optionId: 5, quantity: 2, cardPersons: 3, inComplement: 0, offered: 0 }]);
  assert.deepEqual(stays.customOptionRows(1), [{ customOptionId: 9, description: 'Extra', amount: 15, offered: 0, inComplement: 0, acompteContribTtc: null, soldeContribTtc: null }]);
  assert.deepEqual(stays.resourceRows(1), [{ resourceId: 3, quantity: 1, offered: 0, inComplement: 0, sessions: null }]);
  assert.equal(stays.lockedOptionLines(1)[0].totalPrice, 40);
  assert.equal(stays.lockedResourceLines(1)[0].totalPrice, 30);
  assert.deepEqual(stays.lockedNightlyBreakdown(1).map((n) => n.date), ['2027-06-10', '2027-06-11']); // date-literal-ok: expected seeded nights
});

test('rule 48 — lockedTariff: the row\'s own snapshot, else the stored one, null when none or unreadable', () => {
  const db = stayDb();
  const stays = stayRepository.create(db);
  assert.deepEqual(stays.lockedTariff({ id: 1 }), { extraGuestPriceUnit: 'per_night' });
  assert.deepEqual(stays.lockedTariff({ id: 1, tariffSnapshot: '{"a":1}' }), { a: 1 });
  assert.equal(stays.lockedTariff({ id: 2 }), null);
  assert.equal(stays.lockedTariff({ id: 1, tariffSnapshot: '{broken' }), null);
  assert.equal(stays.lockedTariff({ id: 1, tariffSnapshot: null }), null);
});

test('rule 48 — StayRepository.phaseInputs hands the stay clock its inputs', () => {
  const db = stayDb();
  db.exec('CREATE TABLE properties (id INTEGER PRIMARY KEY, defaultCheckIn TEXT, defaultCheckOut TEXT); INSERT INTO properties VALUES (7, \'16:00\', \'11:00\');');
  db.exec('ALTER TABLE reservations ADD COLUMN checkInTime TEXT; ALTER TABLE reservations ADD COLUMN checkOutTime TEXT');
  assert.deepEqual(stayRepository.create(db).phaseInputs(1), { arrivalDate: '2027-06-10', departureDate: '2027-06-12', checkInTime: '16:00', checkOutTime: '11:00' }); // date-literal-ok: expected seeded stay
});

test('rule 48 — PaymentLedger: no plan, no split, refunds read from the stay\'s refund rows', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservation_installments (reservationId INTEGER, amountCents INTEGER, paid INTEGER);
    INSERT INTO reservation_installments VALUES (1, 10000, 1), (1, 5000, 0);
    CREATE TABLE reservation_refunds (id INTEGER PRIMARY KEY, reservationId INTEGER, refundDate TEXT, method TEXT, totalTtc REAL, reason TEXT, createdAt TEXT, afterCancellation INTEGER);
    INSERT INTO reservation_refunds (reservationId, method, totalTtc) VALUES (1, 'virement', 20), (1, 'especes', 5);
  `);
  const ledger = paymentLedger.create(db);
  assert.deepEqual(ledger.installments(1), { count: 2, scheduled: 150, paid: 100, allPaid: false });
  assert.equal(ledger.installments(2), null);
  assert.equal(ledger.splitReceived(1), null);
  assert.equal(typeof ledger.refunds(1).book, 'number');
  assert.equal(ledger.refunds(404).book, 0);
});
