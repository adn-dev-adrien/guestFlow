// Declaration of the added guests' tourist tax — specs/platform-added-guests-tourist-tax.md rules 11-12,
// 15: declared once collected, a declaration already made does not move. Rule 13 (the books) is tested
// beside the export: plugins/accounting-export/tests/platform-added-guests-tourist-tax-books.unit.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');
const { __test: { arrivalComplementDetailFromReservation } } = require('../models/reservationsModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const pad2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const year = now.getFullYear();
const m = now.getMonth() + 1;
const month = `${year}-${pad2(m)}`;
const day = (d) => `${year}-${pad2(m)}-${pad2(d)}`;

function ensureColumn(db, table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function seed(stay = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec(`CREATE TABLE IF NOT EXISTS platforms (id INTEGER PRIMARY KEY, name TEXT)`);
  for (const [table, column, type] of [
    ['platforms', 'collectsTouristTax', 'INTEGER'], ['platforms', 'touristTaxRemittedByPlatform', 'INTEGER'],
    ['reservations', 'platformGrossAmount', 'REAL'], ['reservations', 'platformPaidGuests', 'INTEGER'],
    ['reservations', 'platformPaidAdults', 'INTEGER'], ['reservations', 'touristTaxDeclaredAt', 'TEXT'],
    ['reservations', 'touristTaxAddedGuestsAmount', 'REAL NOT NULL DEFAULT 0'],
    ['reservations', 'touristTaxAddedGuestsDeclaredAt', 'TEXT'], ['reservations', 'touristTaxFrozenAt', 'TEXT'],
    ['reservations', 'touristTaxFrozenBaseHt', 'REAL'], ['reservations', 'touristTaxFrozenOccupants', 'INTEGER'],
    ['reservations', 'touristTaxFrozenUnitAmount', 'REAL'],
  ]) ensureColumn(db, table, column, type);
  db.prepare('INSERT OR REPLACE INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice)
              VALUES (1, 'Gite', 'per_day_per_person', 1.2, 4, 0)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Canal', 1, 0)").run();
  const row = {
    id: 1, kind: 'reservation', clientId: 1, propertyId: 1, startDate: day(1), endDate: day(3), platform: 'Canal',
    adults: 3, touristTaxRate: 1.2, touristTaxTotal: 7.2, finalPrice: 595.2, totalPrice: 595.2,
    balanceAmount: 600, balancePaid: 1, balancePaidDate: day(2),
    complementAmount: 2.4, complementPaid: 0, complementPaidDate: null,
    platformGrossAmount: 600, platformPaidGuests: 2, platformPaidAdults: 2, touristTaxAddedGuestsAmount: 2.4,
    ...stay,
  };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return { db, model: financeModel.buildModel(db) };
}

const extract = (model) => model.getTouristTaxExtraction({ month });

test('rule 11: a complement not collected → the row declares what the platform reversed', () => {
  const { model } = seed();
  const { data } = extract(model);
  assert.equal(data.reservations.length, 1);
  assert.equal(data.reservations[0].taxAmount, 4.8);
  assert.equal(data.reservations[0].adults, 2);
  assert.equal(data.reservations[0].adultNights, 4);
  assert.equal(data.reservations[0].taxRate, 1.2);
});

test('rule 11: a complement collected → the same row declares the whole tax', () => {
  const { model } = seed({ complementPaid: 1, complementPaidDate: day(1) });
  const { data } = extract(model);
  assert.equal(data.reservations.length, 1);
  assert.equal(data.reservations[0].taxAmount, 7.2);
  assert.equal(data.reservations[0].adults, 3);
  assert.equal(data.totals.taxAmount, 7.2);
});

test('rule 12: collected after the row was declared → the row keeps its amount, a row of its own', () => {
  const { model } = seed({
    complementPaid: 1, complementPaidDate: day(2), touristTaxDeclaredAt: `${day(1)} 09:00:00`,
    balancePaidDate: day(1), touristTaxFrozenAt: `${day(1)} 09:00:00`,
  });
  const { data } = extract(model);
  assert.equal(data.reservations.length, 2);
  const [main, added] = [data.reservations.find((r) => !r.addedGuestsRow), data.reservations.find((r) => r.addedGuestsRow)];
  assert.equal(main.taxAmount, 4.8);
  assert.ok(main.touristTaxDeclaredAt);
  assert.equal(added.taxAmount, 2.4);
  assert.equal(added.adults, 1);
  assert.equal(added.adultNights, 2);
  assert.equal(added.touristTaxDeclaredAt, null);
  assert.equal(added.accommodationAmount, 0);
  assert.equal(data.totals.taxAmount, 7.2);
  assert.equal(data.totals.reservationsCount, 1);
  assert.equal(data.totals.rentedNights, 2);
  assert.equal(data.totals.adultNights, 6);
});

test('rule 12: the added row is ticked on its own', () => {
  const { db, model } = seed({
    complementPaid: 1, complementPaidDate: day(2), touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxFrozenAt: `${day(1)} 09:00:00`,
  });
  const before = db.prepare('SELECT touristTaxDeclaredAt AS at FROM reservations').get().at;
  const res = model.setTouristTaxDeclared({ reservationId: 1, declared: true, addedGuests: true });
  assert.ok(res.data.declaredAt);
  assert.equal(db.prepare('SELECT touristTaxDeclaredAt AS at FROM reservations').get().at, before);
  assert.ok(extract(model).data.reservations.find((r) => r.addedGuestsRow).touristTaxDeclaredAt);
});

test('rule 15: the stored complement detail carries the added tax on its tax line', () => {
  const { detail } = arrivalComplementDetailFromReservation({
    complementAmount: 42.4, touristTaxInComplementAmount: 2.4,
    extraGuestComplementSurcharge: 40, extraGuestComplementCount: 1, options: [], resources: [],
  });
  assert.deepEqual(detail.map((l) => [l.kind, l.amount]), [['extraGuests', 40], ['tax', 2.4]]);
});
