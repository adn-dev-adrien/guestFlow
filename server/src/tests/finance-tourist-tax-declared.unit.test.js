// Tourist-tax « Déclarée » marker (specs/tourist-tax-declared-checkbox.md).
// setTouristTaxDeclared stamps / clears reservations.touristTaxDeclaredAt, and getTouristTaxExtraction
// exposes it per reservation so the extraction page can reflect what's already been declared.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const pad2 = (n) => String(n).padStart(2, '0');

function currentMonth() {
  const now = new Date();
  return { month: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`, year: now.getFullYear(), m: now.getMonth() + 1 };
}

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, touristTaxPerDayPerPerson, touristTaxMode, basePriceIncludedGuests, extraGuestPrice)
              VALUES (1, 'Gite', 1.0, 'per_day_per_person', 0, 0)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const { year, m } = currentMonth();
  const start = `${year}-${pad2(m)}-14`;
  const end = `${year}-${pad2(m)}-16`;
  const paid = `${year}-${pad2(m)}-15`;
  // A direct, solde-paid stay so it surfaces in the current month's extraction.
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults,
                touristTaxRate, touristTaxTotal, finalPrice, totalPrice, balanceAmount, balancePaid, balancePaidDate,
                complementAmount, complementPaid, complementPaidDate)
              VALUES (1, 'reservation', 1, 1, ?, ?, 'direct', 2, 1.0, 4.0, 300, 300, 300, 1, ?, 0, 0, NULL)`)
    .run(start, end, paid);
  return { db, model: financeModel.buildModel(db) };
}

test('setTouristTaxDeclared(true) stamps touristTaxDeclaredAt and returns it', () => {
  const { db, model } = seed();
  const res = model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  assert.equal(res.ok, true);
  assert.ok(res.data.declaredAt, 'a declaredAt date-time is returned');
  const stored = db.prepare('SELECT touristTaxDeclaredAt FROM reservations WHERE id = 1').get().touristTaxDeclaredAt;
  assert.ok(stored, 'the column is set in the DB');
  assert.equal(stored, res.data.declaredAt);
});

test('setTouristTaxDeclared(false) clears the marker back to NULL', () => {
  const { db, model } = seed();
  model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  const res = model.setTouristTaxDeclared({ reservationId: 1, declared: false });
  assert.equal(res.ok, true);
  assert.equal(res.data.declaredAt, null);
  assert.equal(db.prepare('SELECT touristTaxDeclaredAt FROM reservations WHERE id = 1').get().touristTaxDeclaredAt, null);
});

test('setTouristTaxDeclared: unknown reservation → 404', () => {
  const { model } = seed();
  const res = model.setTouristTaxDeclared({ reservationId: 999, declared: true });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test('getTouristTaxExtraction exposes touristTaxDeclaredAt per reservation', () => {
  const { model } = seed();
  const { month } = currentMonth();
  // Not declared yet → null in the payload.
  let ext = model.getTouristTaxExtraction({ month });
  assert.equal(ext.ok, true);
  let row = ext.data.reservations.find((r) => r.reservationId === 1);
  assert.ok(row, 'the seeded stay is in the extraction');
  assert.equal(row.touristTaxDeclaredAt, null);
  // After declaring, the extraction reflects the stored date-time.
  const set = model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  ext = model.getTouristTaxExtraction({ month });
  row = ext.data.reservations.find((r) => r.reservationId === 1);
  assert.equal(row.touristTaxDeclaredAt, set.data.declaredAt);
});
