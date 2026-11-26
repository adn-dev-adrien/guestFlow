// specs/payments/reservation-refunds.md rules 30-31 — a night leaves the tourist-tax declaration only once it
// is WHOLLY refunded: half a night changes nothing, a whole night is deducted. Both extraction paths
// (the stay's own row and the added guests' row) read the refunded nights the same way.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const pad2 = (n) => String(n).padStart(2, '0');
const stayMonth = (() => { const today = new Date(); return new Date(today.getFullYear(), today.getMonth() - 1, 1); })();
const year = stayMonth.getFullYear();
const m = stayMonth.getMonth() + 1;
const month = `${year}-${pad2(m)}`;
const day = (d) => `${year}-${pad2(m)}-${pad2(d)}`;

function ensureColumn(db, table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function seed(stay = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec('CREATE TABLE IF NOT EXISTS platforms (id INTEGER PRIMARY KEY, name TEXT)');
  for (const [table, column, type] of [
    ['platforms', 'collectsTouristTax', 'INTEGER'], ['platforms', 'touristTaxRemittedByPlatform', 'INTEGER'],
    ['reservations', 'platformGrossAmount', 'REAL'], ['reservations', 'platformPaidGuests', 'INTEGER'],
    ['reservations', 'platformPaidAdults', 'INTEGER'], ['reservations', 'touristTaxDeclaredAt', 'TEXT'],
    ['reservations', 'touristTaxAddedGuestsAmount', 'REAL NOT NULL DEFAULT 0'],
    ['reservations', 'touristTaxAddedGuestsDeclaredAt', 'TEXT'], ['reservations', 'touristTaxAddedGuestsAdults', 'INTEGER'],
    ['reservations', 'touristTaxDeclaredWithAddedAmount', 'REAL'], ['reservations', 'platformPaidOccupants', 'INTEGER'],
    ['reservations', 'touristTaxFrozenAt', 'TEXT'],
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
    balanceAmount: 600, balancePaid: 1, balancePaidDate: day(1),
    complementAmount: 2.4, complementPaid: 1, complementPaidDate: day(2),
    platformGrossAmount: 600, platformPaidGuests: 2, platformPaidAdults: 2, touristTaxAddedGuestsAmount: 2.4,
    touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 0,
    touristTaxFrozenAt: `${day(1)} 09:00:00`, touristTaxAddedGuestsAdults: 1,
    ...stay,
  };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return { db, model: financeModel.buildModel(db) };
}

function refundNights(db, nights) {
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO reservation_refunds (reservationId, refundDate, method, totalTtc) VALUES (1, ?, 'transfer', ?)",
  ).run(day(5), nights * 2.4);
  db.prepare(`INSERT INTO reservation_refund_lines (refundId, lineKey, label, bucket, quantity, unitPrice, amountTtc, vatRate)
              VALUES (?, 'touristTax', 'Taxe de séjour', 'touristTax', ?, 2.4, ?, 0)`).run(lastInsertRowid, nights, nights * 2.4);
}

const extract = (model) => model.getTouristTaxExtraction({ month }).data.reservations;
const snapshot = (rows) => rows.map((r) => [Boolean(r.addedGuestsRow), r.nightsCount, r.adultNights, r.taxAmount]);

test('rule 30-31: half a night refunded leaves both declaration rows unchanged', () => {
  const { db, model } = seed();
  const before = snapshot(extract(model));
  assert.equal(before.length, 2, 'the stay row and the added guests row');
  refundNights(db, 0.5);
  assert.deepEqual(snapshot(extract(model)), before);
});

test('rule 30-31: 0.99 of a night is still no night', () => {
  const { db, model } = seed();
  const before = snapshot(extract(model));
  refundNights(db, 0.99);
  assert.deepEqual(snapshot(extract(model)), before);
});

test('rule 30-31: one whole night refunded takes one night off each row', () => {
  const { db, model } = seed();
  const before = extract(model);
  refundNights(db, 1);
  const after = extract(model);
  for (const flag of [false, true]) {
    const b = before.find((r) => Boolean(r.addedGuestsRow) === flag);
    const a = after.find((r) => Boolean(r.addedGuestsRow) === flag);
    assert.equal(a.nightsCount, b.nightsCount - 1, `added=${flag}`);
    assert.ok(a.taxAmount < b.taxAmount, `added=${flag}`);
  }
});
