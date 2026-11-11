// specs/ui-review-2026-10-19-operations.md rules 20 and 21 — « prolonger » an expired quote: only an
// open one, announced before it is done with the very figures the save will write, never a converted
// quote; the list says which quotes are stale.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { isDevisExtendable } = require('../utils/devisValidity');
const { devisListRow } = require('../utils/devisListRow');

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
  db.prepare('INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, 15)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent, balanceDaysBefore) VALUES (1, 'Maison test', 0, 30)").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.generateDevisNumber = () => 'D-TEST-002';
  return { model: devisModel.buildModel(db), db };
}

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const STAY = { propertyId: 1, clientId: 1, startDate: plusDays(90), endDate: plusDays(93), adults: 2, platform: 'direct' };

function expiredQuote(status = 'sent') {
  const { model, db } = freshModel();
  const id = model.create(STAY).data.id;
  db.prepare("UPDATE reservations SET validUntil = ?, createdAt = ?, devisStatus = ? WHERE id = ?")
    .run(plusDays(-11), `${plusDays(-26)} 10:00:00`, status, id);
  return { model, db, id };
}

test('rule 20 — only an expired quote still open is extendable', () => {
  const today = plusDays(0);
  assert.equal(isDevisExtendable({ devisStatus: 'sent', validUntil: plusDays(-1) }, today), true);
  assert.equal(isDevisExtendable({ devisStatus: 'draft', validUntil: plusDays(-1) }, today), true);
  assert.equal(isDevisExtendable({ devisStatus: 'converted', validUntil: plusDays(-1) }, today), false);
  assert.equal(isDevisExtendable({ devisStatus: 'accepted', validUntil: plusDays(-1) }, today), false);
  assert.equal(isDevisExtendable({ devisStatus: 'sent', validUntil: plusDays(3) }, today), false);
  const { model, id } = expiredQuote('converted');
  assert.equal(model.findById(id).extendable, false);
  assert.equal(expiredQuote('sent').model.findById(expiredQuote('sent').id).extendable, true);
});

test('rule 20 — a converted quote is neither previewed, extended nor saved: its row is untouched', () => {
  const { model, db, id } = expiredQuote('converted');
  const before = db.prepare('SELECT validUntil, finalPrice, balanceDueDate FROM reservations WHERE id = ?').get(id);
  assert.equal(model.previewExtension(id).status, 409);
  assert.equal(model.extend(id).status, 409);
  const saved = model.update(id, STAY);
  assert.equal(saved.status, 409);
  assert.equal(saved.code, 'DEVIS_CONVERTED');
  assert.deepEqual(db.prepare('SELECT validUntil, finalPrice, balanceDueDate FROM reservations WHERE id = ?').get(id), before);
});

test('rule 20 — the preview announces the new price and schedule, writes nothing, and the extension writes exactly them', () => {
  const { model, db, id } = expiredQuote('sent');
  // Tariffs went up since the quote was issued.
  db.prepare('UPDATE pricing_rules SET pricePerNight = 150 WHERE id = 1').run();
  const before = db.prepare('SELECT validUntil, finalPrice FROM reservations WHERE id = ?').get(id);
  const preview = model.previewExtension(id);
  assert.equal(preview.ok, true);
  const { current, next, validUntil } = preview.data;
  assert.equal(current.totalTtc, 360);
  assert.equal(next.totalTtc, 450);
  assert.ok(validUntil >= plusDays(0));
  assert.deepEqual(next.schedule.map((l) => l.label), ['Paiement intégral']);
  assert.deepEqual(db.prepare('SELECT validUntil, finalPrice FROM reservations WHERE id = ?').get(id), before, 'a preview writes nothing');

  const extended = model.extend(id);
  assert.equal(extended.ok, true);
  const row = db.prepare('SELECT validUntil, finalPrice, touristTaxTotal, balanceAmount, balanceDueDate FROM reservations WHERE id = ?').get(id);
  assert.equal(row.validUntil, validUntil);
  assert.equal(row.finalPrice + row.touristTaxTotal, next.totalTtc);
  assert.equal(row.balanceAmount, next.schedule[0].amount);
  assert.equal(row.balanceDueDate, next.schedule[0].dueDate);
  assert.equal(extended.data.expired, false);
  assert.equal(extended.data.extendable, false);
});

test('rule 20 — a quote still valid is not extendable (409)', () => {
  const { model } = freshModel();
  const id = model.create(STAY).data.id;
  assert.equal(model.previewExtension(id).status, 409);
});

test('rule 21 — a list row says whether its quote is stale; a converted one never is', () => {
  const today = plusDays(0);
  const stale = devisListRow({ devisStatus: 'sent', validUntil: plusDays(-2), finalPrice: 0 }, today);
  assert.equal(stale.expired, true);
  assert.equal(stale.extendable, true);
  const converted = devisListRow({ devisStatus: 'converted', validUntil: plusDays(-2), finalPrice: 0 }, today);
  assert.equal(converted.expired, false);
  assert.equal(converted.extendable, false);
  const valid = devisListRow({ devisStatus: 'sent', validUntil: plusDays(5), finalPrice: 0 }, today);
  assert.equal(valid.expired, false);
});
