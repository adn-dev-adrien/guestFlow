const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');

// specs/import-price-default-options.md — an iCal/Lodgify import must materialise a PAID default
// option (property_option_defaults.offered = 0) at its REAL amount, not 0 (which used to force the
// operator to open + save the reservation just to price it). Free defaults (offered = 1) stay 0.
// The reservation ROW stays intentionally unpriced (finalPrice = 0) — only the option lines get amounts.
//
// Schema = the iCal-sync import tables (so `syncSource` runs) + the pricing-engine tables (so
// `calculateReservationQuote` can price the default lines). A minimal schema without the pricing
// tables is exercised by property-ical-sync.unit.test.js, where the guarded engine call falls back
// to the legacy zero insert (import never breaks) — that regression stays green.

const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY, name TEXT,
    defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', defaultCautionAmount REAL DEFAULT 0,
    depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
    touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
    touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
    basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, notes TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT,
    platform TEXT, totalPrice REAL, discountPercent REAL, finalPrice REAL,
    depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER,
    sourceType TEXT, sourcePlatformKey TEXT, sourceIcalSourceId INTEGER, sourceIcalEventUid TEXT, icalSyncLocked INTEGER,
    notes TEXT, cautionAmount REAL, icalOriginalSummary TEXT, updatedAt TEXT
  );
  CREATE TABLE ical_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, name TEXT, url TEXT, platformKey TEXT,
    platformLabel TEXT, platformColor TEXT, isActive INTEGER DEFAULT 1,
    lastSyncAt TEXT, lastSyncStatus TEXT, lastSyncMessage TEXT, lastSyncCounts TEXT, lastImportedCount INTEGER, createdAt TEXT, updatedAt TEXT
  );
  CREATE TABLE ical_import_events (
    sourceId INTEGER, eventUid TEXT, reservationId INTEGER, eventHash TEXT,
    startDate TEXT, endDate TEXT, summaryNormalized TEXT, lastSeenAt TEXT,
    UNIQUE(sourceId, eventUid)
  );
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT);
  CREATE TABLE ical_date_drift_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL,
    previousStartDate TEXT NOT NULL, previousEndDate TEXT NOT NULL,
    newStartDate TEXT NOT NULL, newEndDate TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT
  );
  CREATE TABLE ical_cancellation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, sourceId INTEGER NOT NULL,
    eventUid TEXT NOT NULL, detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT
  );
  CREATE TABLE establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
    label TEXT NOT NULL DEFAULT 'Fermeture établissement',
    startDate TEXT NOT NULL, endDate TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE options (
    id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
    countsAsBedLinen INTEGER DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]',
    autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT
  );
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity INTEGER, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER);
  /* Pricing-engine tables (calculateReservationQuote reads these). */
  CREATE TABLE pricing_rules (
    id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
    pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
    progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
    color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
  CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
`;

function icsFeed(events) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function buildDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, 'Logement', '15:00', '10:00', 500)").run();
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  // Paid default « obligatoire mais payante »: Ménage, per_stay, base 40, per-property override 60, offered = 0.
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Ménage', 'per_stay', 40)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 10, 60)').run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, 0)').run();
  // Free default « comprise »: Linge, per_stay, base 25, offered = 1.
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (11, 'Linge', 'per_stay', 25)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 11)').run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 11, 1)').run();
  return db;
}

function stubFetch(events) {
  global.fetch = async () => ({ ok: true, text: async () => icsFeed(events) });
}

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

const source = { id: 1, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' };

test('import prices a paid default at its per-property amount; a free default stays 0; the reservation stays unpriced', async () => {
  const db = buildDb();
  const model = propertyIcalModel.buildModel(db);
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260712', summary: 'Jean Dupont' }]); // 2 nights
  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 1);

  const paid = db.prepare('SELECT * FROM reservation_options WHERE optionId = 10').get();
  assert.ok(paid, 'the paid default option line was created');
  assert.equal(paid.offered, 0);
  assert.equal(paid.totalPrice, 60, 'per-property override (60 €) is materialised at import, not 0');
  assert.equal(paid.unitPrice, 60);
  assert.equal(paid.billedUnits, 1); // per_stay → ×1

  const free = db.prepare('SELECT * FROM reservation_options WHERE optionId = 11').get();
  assert.ok(free, 'the free default option line was created');
  assert.equal(free.offered, 1);
  assert.equal(free.totalPrice, 0, 'offered = 1 default stays free');

  // The reservation ROW stays intentionally unpriced (platform booking) — only lines are priced.
  const resa = db.prepare('SELECT finalPrice, totalPrice FROM reservations').get();
  assert.equal(resa.finalPrice, 0);
  assert.equal(resa.totalPrice, 0);
});

test('import prices a per_night paid default across the stay length', async () => {
  const db = buildDb();
  db.prepare("UPDATE options SET priceType = 'per_night', price = 20 WHERE id = 10").run();
  db.prepare('UPDATE property_option_prices SET price = 20 WHERE optionId = 10').run();
  const model = propertyIcalModel.buildModel(db);
  stubFetch([{ uid: 'E2', start: '20260801', end: '20260804', summary: 'Marie Durand' }]); // 3 nights
  await model.syncSource(source);

  const paid = db.prepare('SELECT * FROM reservation_options WHERE optionId = 10').get();
  assert.equal(paid.billedUnits, 3, 'per_night → billed for the 3 nights');
  assert.equal(paid.totalPrice, 60, '3 × 20 €');
});

test('re-sync with changed dates reprices a pristine per_night default to the new stay length', async () => {
  const db = buildDb();
  db.prepare("UPDATE options SET priceType = 'per_night', price = 20 WHERE id = 10").run();
  db.prepare('UPDATE property_option_prices SET price = 20 WHERE optionId = 10').run();
  const model = propertyIcalModel.buildModel(db);

  stubFetch([{ uid: 'E3', start: '20260801', end: '20260804', summary: 'Léa Martin' }]); // 3 nights
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT billedUnits FROM reservation_options WHERE optionId = 10').get().billedUnits, 3);

  // The platform pushes a longer stay → the (still pristine, non-locked) reservation is updated and its
  // per_night option is repriced to 5 nights.
  stubFetch([{ uid: 'E3', start: '20260801', end: '20260806', summary: 'Léa Martin' }]); // 5 nights
  const result = await model.syncSource(source);
  assert.equal(result.updatedCount, 1);
  const paid = db.prepare('SELECT * FROM reservation_options WHERE optionId = 10').get();
  assert.equal(paid.billedUnits, 5, 'repriced to the new 5-night stay');
  assert.equal(paid.totalPrice, 100, '5 × 20 €');
});

test('re-sync does NOT reprice a LOCKED reservation (operator work is protected)', async () => {
  const db = buildDb();
  db.prepare("UPDATE options SET priceType = 'per_night', price = 20 WHERE id = 10").run();
  db.prepare('UPDATE property_option_prices SET price = 20 WHERE optionId = 10').run();
  const model = propertyIcalModel.buildModel(db);

  stubFetch([{ uid: 'E4', start: '20260801', end: '20260804', summary: 'Paul Roux' }]); // 3 nights
  await model.syncSource(source);
  const resaId = db.prepare('SELECT id FROM reservations').get().id;
  // Simulate an operator edit → the reservation is now sync-locked.
  db.prepare('UPDATE reservations SET icalSyncLocked = 1 WHERE id = ?').run(resaId);

  // A longer stay arrives, but the locked reservation must NOT be touched: dates unchanged, option
  // amount unchanged, and the date change is recorded as a pending drift instead.
  stubFetch([{ uid: 'E4', start: '20260801', end: '20260806', summary: 'Paul Roux' }]); // 5 nights
  const result = await model.syncSource(source);
  assert.equal(result.lockedCount, 1);
  assert.equal(result.updatedCount, 0);

  const paid = db.prepare('SELECT * FROM reservation_options WHERE optionId = 10').get();
  assert.equal(paid.billedUnits, 3, 'locked → option NOT repriced');
  assert.equal(paid.totalPrice, 60, 'locked → amount left as the operator had it');
  assert.equal(db.prepare('SELECT endDate FROM reservations').get().endDate, '2026-08-04', 'locked → dates untouched');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_date_drift_alerts').get().c, 1, 'a pending drift alert was recorded');
});
