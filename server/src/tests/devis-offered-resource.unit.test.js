/**
 * specs/devis-offered-resource-parity.md — a resource marked « offert » must be worth 0 € everywhere.
 *
 * Operator report (2026-08-17): a devis with an offered bain nordique printed its price, did NOT say
 * « Offert », and the amount was deducted from the accommodation row (300 € stay printed 250 €).
 * Root cause: `insertResourceLine` stored `rr.totalPrice || unitPrice * qty`, so the engine's
 * legitimate `totalPrice = 0` was read as « no total » and the resource was re-billed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { buildModel: buildBookingLines } = require('../models/bookingLinesModel');
const { isLineOffered } = require('../utils/devisHelpers');
const { __test: { lineAmounts } } = require('../utils/devisPdf');
const { runOfferedResourceTotalRepair } = require('../utils/offeredResourceTotalRepair');

const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
    defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', defaultCautionAmount REAL DEFAULT 500,
    touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
    touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
    basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
  );
  CREATE TABLE pricing_rules (
    id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
    pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
    progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
    color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
  );
  CREATE TABLE options (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
    priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
    optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT,
    autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT,
    showsPlanningCard INTEGER NOT NULL DEFAULT 0, displayToClient INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
  CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER, pdfLanguage TEXT DEFAULT 'fr',
    requestOrigin TEXT, publicToken TEXT,
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER DEFAULT 1, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT, platform TEXT,
    breakfastTime TEXT, extraGuestSurchargeOffered INTEGER DEFAULT 0, touristTaxInComplement INTEGER DEFAULT 0, tariffSnapshot TEXT,
    totalPrice REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, discountPercent REAL DEFAULT 0,
    customPrice REAL, finalPrice REAL DEFAULT 0, depositAmount REAL DEFAULT 0, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0, cautionAmount REAL DEFAULT 0, notes TEXT, sourceType TEXT,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservation_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL,
    billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
    inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, cardOccurrences TEXT
  );
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, sessions TEXT);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE property_option_defaults (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, quoteValidityDays INTEGER NOT NULL DEFAULT 30, vatRate REAL NOT NULL DEFAULT 10);
  INSERT INTO app_settings (id, quoteValidityDays, vatRate) VALUES (1, 30, 10);
`;

const HOT_TUB = 2; // « Bain nordique », 50 € per stay

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  let serial = 0;
  db.generateDevisNumber = () => `D-OFFER-${++serial}`;
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare(`INSERT INTO resources (id, name, quantity, price, priceType) VALUES (${HOT_TUB}, 'Bain nordique', 1, 50, 'per_stay')`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { model: devisModel.buildModel(db), db };
}

// 3 nights × 100 €.
const BASE = {
  propertyId: 1, clientId: 1,
  startDate: '2030-07-10', endDate: '2030-07-13',
  adults: 2, platform: 'direct',
};

const resourceRow = (db, devisId) => db
  .prepare('SELECT resourceId, quantity, unitPrice, billedUnits, totalPrice, offered FROM reservation_resources WHERE reservationId = ?')
  .get(devisId);

// The accommodation row the PDF draws: `finalPrice` minus the extras it BILLS (an offered line
// contributes 0). Same arithmetic as the manual-price branch of the renderer.
const printedAccommodation = (devis) => Math.round((
  Number(devis.finalPrice || 0)
  - (devis.options || []).reduce((s, o) => s + lineAmounts(o).billed, 0)
  - (devis.resources || []).reduce((s, r) => s + lineAmounts(r).billed, 0)
) * 100) / 100;

test('REGRESSION: an offered resource is stored at 0 €, not re-billed at its catalogue price', () => {
  const { model, db } = freshModel();
  const devis = model.create({ ...BASE, selectedResources: [{ resourceId: HOT_TUB, quantity: 1, offered: true }] }).data;

  assert.equal(devis.finalPrice, 300, 'the guest pays the stay only — the bain nordique is a gesture');
  const row = resourceRow(db, devis.id);
  assert.equal(row.offered, 1);
  assert.equal(row.totalPrice, 0, 'the bug stored 50 € here');
  assert.equal(row.unitPrice, 50, 'the real price stays recoverable (offering is lossless)');
});

test('REGRESSION: the offered resource no longer eats into the accommodation row', () => {
  const { model } = freshModel();
  const devis = model.create({ ...BASE, selectedResources: [{ resourceId: HOT_TUB, quantity: 1, offered: true }] }).data;
  assert.equal(printedAccommodation(devis), 300, 'printed 250 € before the fix');
});

test('a billed resource is untouched: full price stored, subtracted from the accommodation row', () => {
  const { model, db } = freshModel();
  const devis = model.create({ ...BASE, selectedResources: [{ resourceId: HOT_TUB, quantity: 1 }] }).data;

  assert.equal(devis.finalPrice, 350);
  assert.equal(resourceRow(db, devis.id).totalPrice, 50);
  assert.equal(printedAccommodation(devis), 300);
});

test('insertResourceLine: no total supplied → still falls back to unitPrice × quantity', () => {
  const db = new Database(':memory:');
  db.exec(DDL);
  const lines = buildBookingLines(db);
  lines.insertResourceLine(1, { resourceId: HOT_TUB, billedUnits: 2 }, 30, 2, 'per_unit');
  const row = db.prepare('SELECT totalPrice, offered FROM reservation_resources WHERE reservationId = 1').get();
  assert.equal(row.totalPrice, 60, 'the fallback only covers a caller that supplies no total at all');
  assert.equal(row.offered, 0);
});

test('lineAmounts: a legacy offered row still prints 0 € with its real price struck through', () => {
  // The row the bug wrote: flagged offered, persisted WITH the phantom price. Old devis must print
  // right without waiting for a re-save.
  assert.deepEqual(
    lineAmounts({ offered: 1, totalPrice: 50, originalTotalPrice: 50, unitPrice: 50, billedUnits: 1 }),
    { offered: true, billed: 0, real: 50 },
  );
  // A repaired row: the real price is rebuilt from the unit price.
  assert.deepEqual(
    lineAmounts({ offered: 1, totalPrice: 0, unitPrice: 50, billedUnits: 1 }),
    { offered: true, billed: 0, real: 50 },
  );
  // A billed line is unchanged.
  assert.deepEqual(
    lineAmounts({ offered: 0, totalPrice: 50, originalTotalPrice: 50, unitPrice: 50, billedUnits: 1 }),
    { offered: false, billed: 50, real: 50 },
  );
});

test('isLineOffered: the stored flag wins, the legacy heuristic still applies', () => {
  // A legacy row: flagged offered but persisted WITH the phantom price → must still print « Offert ».
  assert.equal(isLineOffered({ offered: 1, totalPrice: 50, unitPrice: 50, billedUnits: 1 }), true);
  // Quote lines reach the renderer without the column: the historical heuristic keeps them covered.
  assert.equal(isLineOffered({ totalPrice: 0, unitPrice: 50, billedUnits: 1 }), true);
  // A normally-billed line is never a gesture.
  assert.equal(isLineOffered({ offered: 0, totalPrice: 50, unitPrice: 50, billedUnits: 1 }), false);
});

test('repair: legacy offered rows are zeroed, billed rows untouched, second run is a no-op', () => {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered) VALUES (1, 2, 1, 50, 1, 50, 1)').run();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered) VALUES (2, 2, 1, 50, 1, 50, 0)').run();

  assert.equal(runOfferedResourceTotalRepair(db).repairedCount, 1);
  assert.equal(db.prepare('SELECT totalPrice FROM reservation_resources WHERE reservationId = 1').get().totalPrice, 0);
  assert.equal(db.prepare('SELECT totalPrice FROM reservation_resources WHERE reservationId = 2').get().totalPrice, 50, 'a billed line is never touched');
  assert.equal(db.prepare('SELECT unitPrice FROM reservation_resources WHERE reservationId = 1').get().unitPrice, 50, 'the real price survives the repair');
  assert.equal(runOfferedResourceTotalRepair(db).repairedCount, 0, 'idempotent');
});

test('recomputeQuote replays the offered resource at 0 € (price lock unchanged)', () => {
  const { model } = freshModel();
  const devis = model.create({ ...BASE, selectedResources: [{ resourceId: HOT_TUB, quantity: 1, offered: true }] }).data;

  const quote = model.recomputeQuote(devis.id);
  assert.equal(quote.finalPrice, devis.finalPrice, 'the PDF total still matches the devis');
  const line = (quote.resourceLines || []).find((l) => Number(l.resourceId) === HOT_TUB);
  assert.equal(line.totalPrice, 0);
  assert.equal(Boolean(line.offered), true);
});
