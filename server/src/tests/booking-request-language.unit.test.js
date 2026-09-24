/**
 * specs/site-english-version.md §3 rules 11-13 — the language, and the origin, of a public request.
 *
 * Two things are pinned here, both of them silently wrong before:
 *   - an explicit language overwrites the guest's stored one, silence does not — and silence is the
 *     normal case, since the plugin deployed today sends no language at all;
 *   - `requestOrigin` and the quote language survive the conversion to a reservation. Until they
 *     did, a booking from the website looked internal the moment it stopped being hypothetical.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// The module exports a model bound to the app database, with the factory hung off `.create`.
const clientsModel = require('../models/clientsModel');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lastName TEXT, firstName TEXT, streetNumber TEXT, street TEXT, postalCode TEXT, city TEXT,
      address TEXT, phone TEXT, email TEXT, notes TEXT,
      emailLanguage TEXT NOT NULL DEFAULT 'fr',
      createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT
    );
  `);
  return db;
}

// ── Rule 11-12 — the language on the guest record ────────────────────────────

test('a guest created by an English request is stored as English', () => {
  const db = freshDb();
  const clients = clientsModel.create(db);
  const client = clients.insert({
    firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '', emailLanguage: 'en',
  });
  assert.equal(client.emailLanguage, 'en');
});

test('a guest created without any language is French, exactly as before', () => {
  const db = freshDb();
  const clients = clientsModel.create(db);
  const client = clients.insert({ firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.c', phone: '' });
  assert.equal(client.emailLanguage, 'fr');
});

test('specs/site-english-version.md rule 21 — an update that does not mention the language leaves it alone', () => {
  // The accident this guard exists for: the client dialog opened from the reservation page did not
  // carry emailLanguage, and buildClientFields normalises an absent value to 'fr'. Editing a phone
  // number reset an English guest to French.
  const db = freshDb();
  const clients = clientsModel.create(db);
  const client = clients.insert({ firstName: 'Ada', lastName: 'L', email: 'a@b.c', emailLanguage: 'en' });

  const updated = clients.update(client.id, {
    firstName: 'Ada', lastName: 'L', email: 'a@b.c', phone: '0600000000',
  });
  assert.equal(updated.emailLanguage, 'en', 'an unmentioned language must survive the update');
});

test('an update that does mention the language sets it', () => {
  const db = freshDb();
  const clients = clientsModel.create(db);
  const client = clients.insert({ firstName: 'Ada', lastName: 'L', email: 'a@b.c', emailLanguage: 'en' });
  const updated = clients.update(client.id, {
    firstName: 'Ada', lastName: 'L', email: 'a@b.c', emailLanguage: 'fr',
  });
  assert.equal(updated.emailLanguage, 'fr', 'an explicit choice must be obeyed, in both directions');
});

test('an empty language on an update is still an explicit value, and means French', () => {
  const db = freshDb();
  const clients = clientsModel.create(db);
  const client = clients.insert({ firstName: 'Ada', lastName: 'L', email: 'a@b.c', emailLanguage: 'en' });
  const updated = clients.update(client.id, {
    firstName: 'Ada', lastName: 'L', email: 'a@b.c', emailLanguage: '',
  });
  assert.equal(updated.emailLanguage, 'fr');
});

// ── Rule 13 — what survives the conversion to a reservation ──────────────────

const devisModel = require('../models/devisModel');

const CONVERSION_DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER,
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER,
    checkInTime TEXT, checkOutTime TEXT, platform TEXT, totalPrice REAL,
    touristTaxRate REAL, touristTaxTotal REAL, discountPercent REAL, customPrice REAL, finalPrice REAL,
    depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0,
    sourceType TEXT,
    cautionAmount REAL, notes TEXT, breakfastTime TEXT,
    extraGuestSurchargeOffered INTEGER DEFAULT 0, touristTaxInComplement INTEGER DEFAULT 0,
    tariffSnapshot TEXT,
    requestOrigin TEXT, publicToken TEXT,
    emailLanguage TEXT NOT NULL DEFAULT 'fr', pdfLanguage TEXT NOT NULL DEFAULT 'fr',
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT);
`;

/** A devis row as the public booking funnel writes one. */
function devisFromTheSite(overrides = {}) {
  const db = new Database(':memory:');
  db.exec(CONVERSION_DDL);
  db.prepare('INSERT INTO properties (id, name) VALUES (1, ?)').run('La Granja');
  const columns = {
    kind: 'devis', devisNumber: 'D-1', devisStatus: 'pending',
    propertyId: 1, clientId: 1, startDate: '2026-07-10', endDate: '2026-07-13',
    adults: 2, children: 0, teens: 0, babies: 0, platform: 'direct',
    totalPrice: 600, finalPrice: 600,
    requestOrigin: 'public', publicToken: 'tok', pdfLanguage: 'fr',
    ...overrides,
  };
  const names = Object.keys(columns);
  db.prepare(`INSERT INTO reservations (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((n) => columns[n]));
  const devisId = db.prepare("SELECT id FROM reservations WHERE kind = 'devis'").get().id;
  return { db, model: devisModel.buildModel(db), devisId };
}

test('a reservation born of a website request still says so', () => {
  const { db, model, devisId } = devisFromTheSite();
  const { data } = model.convertToReservation(devisId);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(data.reservationId);
  assert.equal(reservation.requestOrigin, 'public',
    'the origin badge must survive the conversion, or the site disappears from the statistics');
});

test('a reservation created internally is not relabelled as a website request', () => {
  const { db, model, devisId } = devisFromTheSite({ requestOrigin: null });
  const { data } = model.convertToReservation(devisId);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(data.reservationId);
  assert.equal(reservation.requestOrigin, null);
});

test('an English quote produces an English reservation on BOTH columns', () => {
  // They are read by different code paths: emails resolve from emailLanguage, the PDF from
  // pdfLanguage. Carrying one alone ships an English email with a French PDF attached.
  const { db, model, devisId } = devisFromTheSite({ pdfLanguage: 'en' });
  const { data } = model.convertToReservation(devisId);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(data.reservationId);
  assert.equal(reservation.emailLanguage, 'en');
  assert.equal(reservation.pdfLanguage, 'en');
});

test('a French quote stays French on both columns', () => {
  const { db, model, devisId } = devisFromTheSite({ pdfLanguage: 'fr' });
  const { data } = model.convertToReservation(devisId);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(data.reservationId);
  assert.equal(reservation.emailLanguage, 'fr');
  assert.equal(reservation.pdfLanguage, 'fr');
});
