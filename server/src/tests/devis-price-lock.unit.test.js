/**
 * specs/devis-extras-parity-and-price-lock.md §3 rules 13-16 — a quote holds its price until it expires.
 *
 * A devis is a price promise with an end date: re-opening and re-saving a VALID one must not move a
 * cent, even if the tariff has been raised in the meantime; once the validity date is past, the same
 * save re-prices everything at the current tariffs and re-issues a fresh window.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { isDevisExpired, computeValidUntil } = require('../utils/devisValidity');

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
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, quoteValidityDays INTEGER NOT NULL DEFAULT 30);
  INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, 30);
`;

const CLEANING = 1;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  let serial = 0;
  db.generateDevisNumber = () => `D-LOCK-${++serial}`;
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare(`INSERT INTO options (id, title, priceType, price) VALUES (${CLEANING}, 'Ménage', 'per_stay', 80)`).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(CLEANING);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { model: devisModel.buildModel(db), db };
}

// Far-future stay so `validUntil` is driven by quoteValidityDays, not by the startDate − 2 cap.
const BASE = {
  propertyId: 1,
  clientId: 1,
  startDate: '2030-07-10',
  endDate: '2030-07-13',
  adults: 2,
  platform: 'direct',
  selectedOptions: [{ optionId: CLEANING, quantity: 1 }],
};

// Raise every price after the quote was issued.
function raiseTariffs(db) {
  db.prepare('UPDATE pricing_rules SET pricePerNight = 200 WHERE propertyId = 1').run();
  db.prepare('UPDATE options SET price = 200 WHERE id = ?').run(CLEANING);
}

function expire(db, devisId) {
  db.prepare("UPDATE reservations SET validUntil = '2020-01-01' WHERE id = ?").run(devisId);
}

test('a VALID devis keeps its quoted prices across a tariff rise (rule 13)', () => {
  const { model, db } = freshModel();
  const created = model.create(BASE);
  const quotedTotal = created.data.finalPrice;
  assert.equal(quotedTotal, 380); // 3 × 100 + 80

  raiseTariffs(db);
  const updated = model.update(created.data.id, { ...BASE, notes: 'rappel client' });

  assert.equal(updated.data.finalPrice, quotedTotal, 'the guest was quoted 380 € and still owes 380 €');
  assert.equal(updated.data.options.find((o) => Number(o.optionId) === CLEANING).totalPrice, 80);
});

test('an EXPIRED devis is re-priced at the current tariffs (rule 14)', () => {
  const { model, db } = freshModel();
  const created = model.create(BASE);
  raiseTariffs(db);
  expire(db, created.data.id);

  const updated = model.update(created.data.id, { ...BASE, notes: 'relance' });

  assert.equal(updated.data.finalPrice, 800); // 3 × 200 + 200
  assert.equal(updated.data.options.find((o) => Number(o.optionId) === CLEANING).totalPrice, 200);
});

test('saving an expired devis re-issues a validity window (rule 14)', () => {
  const { model, db } = freshModel();
  const created = model.create(BASE);
  expire(db, created.data.id);

  const updated = model.update(created.data.id, { ...BASE });
  const today = new Date().toISOString().slice(0, 10);

  assert.equal(isDevisExpired(updated.data.validUntil, today), false, 'the refreshed quote is valid again');
  assert.equal(updated.data.expired, false);
  assert.equal(updated.data.pricingLocked, true);
});

test('« Actualiser les tarifs » re-prices a still-valid devis on demand (rule 15)', () => {
  const { model, db } = freshModel();
  const created = model.create(BASE);
  raiseTariffs(db);

  const updated = model.update(created.data.id, { ...BASE, refreshPricingToCurrent: true });

  assert.equal(updated.data.finalPrice, 800, 'the operator explicitly asked for today\'s tariffs');
});

test('moving the stay dates drops the lock — those prices were for other nights', () => {
  const { model, db } = freshModel();
  const created = model.create(BASE);
  raiseTariffs(db);

  const updated = model.update(created.data.id, { ...BASE, startDate: '2030-08-10', endDate: '2030-08-13' });

  assert.equal(updated.data.finalPrice, 800);
});

test('findById exposes the validity verdict the fiche renders (rule 16)', () => {
  const { model, db } = freshModel();
  const created = model.create(BASE);

  const fresh = model.findById(created.data.id);
  assert.equal(fresh.expired, false);
  assert.equal(fresh.pricingLocked, true);
  assert.ok(fresh.validUntil, 'a date to show in the chip');

  expire(db, created.data.id);
  const stale = model.findById(created.data.id);
  assert.equal(stale.expired, true);
  assert.equal(stale.pricingLocked, false);
});

test('a legacy devis with no validUntil is treated as expired, and gets one on the first save', () => {
  const { model, db } = freshModel();
  const created = model.create(BASE);
  db.prepare('UPDATE reservations SET validUntil = NULL WHERE id = ?').run(created.data.id);
  raiseTariffs(db);

  assert.equal(model.findById(created.data.id).expired, true);
  const updated = model.update(created.data.id, { ...BASE });
  assert.equal(updated.data.finalPrice, 800, 'an undated quote cannot freeze a price');
  assert.ok(updated.data.validUntil);
});

test('isDevisExpired: the validity date is inclusive', () => {
  assert.equal(isDevisExpired('2026-08-14', '2026-08-14'), false);
  assert.equal(isDevisExpired('2026-08-13', '2026-08-14'), true);
  assert.equal(isDevisExpired(null, '2026-08-14'), true);
  assert.equal(isDevisExpired('', '2026-08-14'), true);
  assert.equal(isDevisExpired('pas-une-date', '2026-08-14'), true);
});

test('computeValidUntil still caps at startDate − 2 days', () => {
  assert.equal(computeValidUntil({ createdAtIsoDate: '2026-08-01', startDateIso: '2026-08-10', quoteValidityDays: 30 }), '2026-08-08');
  assert.equal(computeValidUntil({ createdAtIsoDate: '2026-08-01', startDateIso: '2030-08-10', quoteValidityDays: 30 }), '2026-08-31');
});
