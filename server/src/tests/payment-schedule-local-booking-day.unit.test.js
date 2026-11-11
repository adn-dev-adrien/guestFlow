// specs/payment-schedule-and-cancellation.md rule 54 — the payment schedule reads the booking day on the
// operator's calendar, like the VAT regime and « today ». `createdAt` is a UTC timestamp: between 00:00
// and 01:00 / 02:00 in Paris its first ten characters are still yesterday, so the schedule computed on
// create (local day) flipped at the first unchanged re-save (UTC day). The clock is frozen at
// 2026-10-30T23:30Z: 31/10 00:30 in Paris, still 30/10 in UTC.
process.env.TZ = 'Europe/Paris';
process.env.DB_PATH = ':memory:';

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
const { toIsoDay, isLastMinuteStay, resolveDepositDueDate } = require('../utils/paymentSchedule');

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

const SCHEDULE_COLUMNS = 'depositAmount, depositDueDate, balanceAmount, balanceDueDate, finalPrice';
// Booked on 31/10 (Paris), arrival 30/11: exactly 30 days out, the last-minute threshold (inclusive).
const LAST_MINUTE_STAY = { propertyId: 1, clientId: 1, startDate: '2026-11-30', endDate: '2026-12-03', adults: 2, platform: 'direct' };

test('rule 54 — toIsoDay keeps a date-only value as it is', () => {
  assert.equal(toIsoDay('2026-10-30'), '2026-10-30');
});

test('rule 54 — toIsoDay reads a UTC datetime on its Paris day', () => {
  assert.equal(toIsoDay('2026-10-30 23:30:00'), '2026-10-31');
  assert.equal(toIsoDay('2026-10-30T23:30:00.000Z'), '2026-10-31');
  assert.equal(toIsoDay('2026-10-30 12:00:00'), '2026-10-30');
});

test('rule 54 — toIsoDay rejects what is not a day', () => {
  assert.equal(toIsoDay(null), null);
  assert.equal(toIsoDay(''), null);
  assert.equal(toIsoDay('not a date'), null);
});

test('rule 54 — a stay booked at 00:30 Paris, 30 days out, is last-minute from the timestamp too', () => {
  assert.equal(isLastMinuteStay({ bookingDate: '2026-10-30 23:30:00', startDate: '2026-11-30' }), true);
  assert.equal(isLastMinuteStay({ bookingDate: '2026-10-31', startDate: '2026-11-30' }), true);
});

test('rule 54 — the acompte deadline counts from the Paris booking day', () => {
  assert.equal(resolveDepositDueDate({ bookingDate: '2026-10-30 23:30:00', depositDueDays: 7 }), '2026-11-07');
});

test('rule 54 — devis: an unchanged re-save keeps the schedule it was created with', () => {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, 30)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent, balanceDaysBefore, depositDaysBefore) VALUES (1, 'Maison test', 30, 30, 7)").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.generateDevisNumber = () => 'D-TEST-1';
  const model = devisModel.buildModel(db);

  const { data } = model.create(LAST_MINUTE_STAY);
  const read = () => db.prepare(`SELECT ${SCHEDULE_COLUMNS} FROM reservations WHERE id = ?`).get(data.id);
  const created = read();
  assert.equal(created.depositAmount, 0, 'booked 30 days out: one single payment');

  const saved = model.update(data.id, { ...LAST_MINUTE_STAY, status: 'draft' });
  assert.ok(!saved.error, JSON.stringify(saved));
  assert.deepEqual(read(), created);
});

// The reservation path: the real controller on the boot schema. SQLite stamps `createdAt` with its own
// clock, so the row is given the frozen instant's UTC timestamp, as a real save at 00:30 would carry.
const fakeRes = () => ({
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('rule 54 — reservation: an unchanged re-save and the fiche keep the schedule it was created with', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  db.prepare("INSERT INTO properties (id, name, maxGuests, depositPercent, depositEnabled, balanceDaysBefore) VALUES (1, 'Maison test', 4, 30, 1, 30)").run();
  db.prepare('INSERT INTO pricing_rules (propertyId, pricePerNight, minNights) VALUES (1, 120, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const body = {
    ...LAST_MINUTE_STAY, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 1, babyBeds: 0,
    checkInTime: '16:00', checkOutTime: '10:00', reservationOptions: [], discountPercent: 0, customPrice: '',
  };

  const created = fakeRes();
  await controller.create({ body }, created);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const { id } = created.body;
  db.prepare("UPDATE reservations SET createdAt = '2026-10-30 23:30:00' WHERE id = ?").run(id);
  const read = () => db.prepare(`SELECT ${SCHEDULE_COLUMNS} FROM reservations WHERE id = ?`).get(id);
  const stored = read();
  assert.deepEqual([stored.depositAmount, stored.balanceAmount], [0, 360], 'booked 30 days out: one single payment');

  const saved = fakeRes();
  await controller.update({ params: { id: String(id) }, body: { ...body } }, saved);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(read(), stored);

  const preview = fakeRes();
  await controller.calculatePrice({ body: { ...body, reservationId: id } }, preview);
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  const { depositAmount, depositDueDate, balanceAmount, balanceDueDate } = preview.body;
  assert.deepEqual(
    { depositAmount, depositDueDate, balanceAmount, balanceDueDate },
    { depositAmount: stored.depositAmount, depositDueDate: stored.depositDueDate, balanceAmount: stored.balanceAmount, balanceDueDate: stored.balanceDueDate },
  );
});
