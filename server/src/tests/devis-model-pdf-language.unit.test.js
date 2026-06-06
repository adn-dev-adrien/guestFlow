// Persistence + validation of the `pdfLanguage` column on devis rows.
// See specs/devis-english-language.md §3 rule 1 + §4.3.
//
// Schema mirrors `tests/devis-model-create.unit.test.js` (same pricing tables the engine reads),
// extended with the new `pdfLanguage` column.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');

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
    titleEn TEXT NOT NULL DEFAULT '', descriptionEn TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
  CREATE TABLE property_option_defaults (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0,
    nameEn TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER,
    propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, adults INTEGER DEFAULT 1, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT, platform TEXT,
    totalPrice REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, discountPercent REAL DEFAULT 0,
    customPrice REAL, finalPrice REAL DEFAULT 0, depositAmount REAL DEFAULT 0, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0, cautionAmount REAL DEFAULT 0, notes TEXT, sourceType TEXT,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now')),
    pdfLanguage TEXT NOT NULL DEFAULT 'fr'
  );
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, quoteValidityDays INTEGER NOT NULL DEFAULT 30);
  INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, 30);
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.generateDevisNumber = () => 'D-LANG-001';
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jane', 'Smith')").run();
  return { model: devisModel.buildModel(db), db };
}

const BASE = { propertyId: 1, clientId: 1, startDate: '2026-07-10', endDate: '2026-07-13', adults: 2 };

const PDF_LANG_OF = (db, id) => db.prepare('SELECT pdfLanguage FROM reservations WHERE id = ?').get(id).pdfLanguage;

test('create: defaults pdfLanguage to "fr" when not provided', () => {
  const { model, db } = freshModel();
  const r = model.create({ ...BASE });
  assert.equal(r.status, 201);
  assert.equal(PDF_LANG_OF(db, r.data.id), 'fr');
});

test('create: accepts pdfLanguage = "en"', () => {
  const { model, db } = freshModel();
  const r = model.create({ ...BASE, pdfLanguage: 'en' });
  assert.equal(PDF_LANG_OF(db, r.data.id), 'en');
});

test('create: silently coerces unknown language to "fr" (no junk persisted)', () => {
  const { model, db } = freshModel();
  const r = model.create({ ...BASE, pdfLanguage: 'de' });
  assert.equal(PDF_LANG_OF(db, r.data.id), 'fr');
});

test('create: lower-cases mixed-case input', () => {
  const { model, db } = freshModel();
  const r = model.create({ ...BASE, pdfLanguage: 'EN' });
  assert.equal(PDF_LANG_OF(db, r.data.id), 'en');
});

test('update: missing pdfLanguage in payload PRESERVES the existing value', () => {
  const { model, db } = freshModel();
  const created = model.create({ ...BASE, pdfLanguage: 'en' });
  model.update(created.data.id, { ...BASE, adults: 3 }); // no pdfLanguage in payload
  assert.equal(PDF_LANG_OF(db, created.data.id), 'en');
});

test('update: explicit "fr" switches back', () => {
  const { model, db } = freshModel();
  const created = model.create({ ...BASE, pdfLanguage: 'en' });
  model.update(created.data.id, { ...BASE, pdfLanguage: 'fr' });
  assert.equal(PDF_LANG_OF(db, created.data.id), 'fr');
});

test('update: invalid value silently keeps existing — no reset to fr', () => {
  const { model, db } = freshModel();
  const created = model.create({ ...BASE, pdfLanguage: 'en' });
  model.update(created.data.id, { ...BASE, pdfLanguage: 'xx' });
  assert.equal(PDF_LANG_OF(db, created.data.id), 'en');
});

test('findById: surfaces pdfLanguage on the returned row', () => {
  const { model } = freshModel();
  const created = model.create({ ...BASE, pdfLanguage: 'en' });
  assert.equal(model.findById(created.data.id).pdfLanguage, 'en');
});

test('findById: surfaces option.titleEn + resource.nameEn so the PDF can read them', () => {
  const { model, db } = freshModel();
  db.prepare(`INSERT INTO options (id, title, titleEn, priceType, price)
              VALUES (2, 'Petit déjeuner', 'Breakfast', 'per_person_per_night', 0)`).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 2)').run();
  db.prepare("INSERT INTO resources (id, name, nameEn, priceType, price) VALUES (1, 'Lit bébé', 'Baby bed', 'per_stay', 0)").run();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (1, 1, 0)').run();

  const created = model.create({
    ...BASE,
    pdfLanguage: 'en',
    selectedOptions: [{ optionId: 2, quantity: 1 }],
    selectedResources: [{ resourceId: 1, quantity: 1 }],
  });
  const full = model.findById(created.data.id);
  const breakfast = (full.options || []).find((o) => o.optionId === 2);
  const babyBed   = (full.resources || []).find((r) => r.resourceId === 1);
  assert.ok(breakfast, 'breakfast option present');
  assert.equal(breakfast.titleEn, 'Breakfast', 'titleEn surfaced on the enriched devis');
  assert.ok(babyBed, 'baby bed resource present');
  assert.equal(babyBed.nameEn, 'Baby bed', 'nameEn surfaced on the enriched devis');
});
