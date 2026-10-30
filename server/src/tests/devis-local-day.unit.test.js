// specs/devis-pdf-and-tourist-tax-fixes.md rule 23 and specs/devis-extras-parity-and-price-lock.md
// rule 21 — a devis reads « today » and its creation day in the operator's time zone, like the rest
// of the server. The clock is frozen at 2026-10-30T23:30Z: 31/10 00:30 in Paris, still 30/10 in UTC.
process.env.TZ = 'Europe/Paris';

const FROZEN = Date.parse('2026-10-30T23:30:00Z');
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...args) { if (args.length === 0) super(FROZEN); else super(...args); }
  static now() { return FROZEN; }
};

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { __test: { resolveDevisDates } } = require('../utils/devisPdf');
const { todayIso } = require('../utils/localDate');

const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY, name TEXT,
    defaultCheckIn TEXT, defaultCheckOut TEXT, defaultCautionAmount REAL,
    depositPercent REAL, depositDaysBefore INTEGER, balanceDaysBefore INTEGER,
    minNights INTEGER, basePrice REAL
  );
  CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, pricePerNight REAL, minNights INTEGER, startDate TEXT, endDate TEXT);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, priceType TEXT, price REAL, autoOptionType TEXT, autoFullNightThreshold TEXT);
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY(propertyId, optionId));
  CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, priceType TEXT, price REAL);
  CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY(propertyId, resourceId));
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER,
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT,
    platform TEXT, totalPrice REAL, touristTaxRate REAL, touristTaxTotal REAL, discountPercent REAL,
    customPrice REAL, finalPrice REAL, depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0,
    cautionAmount REAL, notes TEXT, sourceType TEXT,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT
  );
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(propertyId, optionId));
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, quoteValidityDays INTEGER NOT NULL DEFAULT 30);
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, 30)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Maison test')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  let seq = 0;
  db.generateDevisNumber = () => `D-TEST-${++seq}`;
  return { model: devisModel.buildModel(db), db };
}

const STAY = { propertyId: 1, clientId: 1, startDate: '2027-07-10', endDate: '2027-07-13', adults: 2, platform: 'direct' };

function sentDevisValidUntil(db, model, validUntil) {
  const created = model.create(STAY);
  assert.ok(created.data && created.data.id, JSON.stringify(created));
  db.prepare("UPDATE reservations SET validUntil = ?, devisStatus = 'sent' WHERE id = ?").run(validUntil, created.data.id);
  return created.data.id;
}

test('the frozen clock sits in the window where Paris is one day ahead of UTC', () => {
  assert.equal(todayIso(), '2026-10-31');
  assert.equal(new Date().toISOString().slice(0, 10), '2026-10-30');
});

test('rule 23 — a devis created at 00:30 Paris counts its validity from the Paris day', () => {
  const { model, db } = freshModel();
  const { data } = model.create(STAY);
  const row = db.prepare('SELECT createdAt, validUntil FROM reservations WHERE id = ?').get(data.id);
  assert.equal(row.createdAt, '2026-10-30 23:30:00', 'the stored timestamp stays UTC');
  assert.equal(row.validUntil, '2026-11-30');
});

test('rule 23 — a legacy devis without validUntil resolves it from its local creation day', () => {
  const { model, db } = freshModel();
  const { data } = model.create(STAY);
  db.prepare("UPDATE reservations SET validUntil = NULL, createdAt = '2026-10-01 22:30:00' WHERE id = ?").run(data.id);
  // 22:30Z on 01/10 is 02/10 00:30 in Paris (CEST).
  assert.equal(model.findById(data.id).validUntil, '2026-11-01');
});

test('rule 23 — a devis drawn from a reservation at 00:30 Paris counts its validity from the Paris day', () => {
  const { model, db } = freshModel();
  const { lastInsertRowid } = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, platform, finalPrice)
    VALUES ('reservation', 1, 1, '2027-07-10', '2027-07-13', 2, 'direct', 360)`).run();
  const converted = model.convertFromReservation(lastInsertRowid);
  assert.ok(!converted.error, JSON.stringify(converted));
  const row = db.prepare("SELECT validUntil FROM reservations WHERE kind = 'devis'").get();
  assert.equal(row.validUntil, '2026-11-30');
});

test('rule 21 — a devis valid until yesterday (Paris) reads expired and extendable', () => {
  const { model, db } = freshModel();
  const id = sentDevisValidUntil(db, model, '2026-10-30');
  const found = model.findById(id);
  assert.equal(found.expired, true);
  assert.equal(found.extendable, true);
});

test('rule 21 — the list chip reads the Paris day', () => {
  const { model, db } = freshModel();
  sentDevisValidUntil(db, model, '2026-10-30');
  const [row] = model.list({});
  assert.equal(row.expired, true);
});

test('rule 21 — « prolonger » accepts a devis that expired yesterday (Paris) and opens the window today', () => {
  const { model, db } = freshModel();
  const id = sentDevisValidUntil(db, model, '2026-10-30');
  const preview = model.previewExtension(id);
  assert.ok(!preview.error, JSON.stringify(preview));
  const extended = model.extend(id);
  assert.ok(!extended.error, JSON.stringify(extended));
  assert.equal(db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(id).validUntil, '2026-11-30');
});

test('rule 21 — saving a devis that expired yesterday (Paris) re-issues its window from today', () => {
  const { model, db } = freshModel();
  const id = sentDevisValidUntil(db, model, '2026-10-30');
  const saved = model.update(id, { ...STAY, status: 'sent' });
  assert.ok(!saved.error, JSON.stringify(saved));
  assert.equal(db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(id).validUntil, '2026-11-30');
});

test('rule 23 — the PDF « Date du devis » is the Paris day of a UTC createdAt', () => {
  const dates = resolveDevisDates({ createdAt: '2026-10-30 23:30:00', validUntil: null, startDate: '2027-07-10' }, { quoteValidityDays: 30 });
  assert.deepEqual(dates, { createdAtIsoDate: '2026-10-31', validUntilIso: '2026-11-30' });
});

test('rule 23 — the PDF falls back to the Paris day when createdAt is blank', () => {
  const dates = resolveDevisDates({ createdAt: '', validUntil: '2026-12-01', startDate: '2027-07-10' }, { quoteValidityDays: 30 });
  assert.deepEqual(dates, { createdAtIsoDate: '2026-10-31', validUntilIso: '2026-12-01' });
});
