// specs/non-card-option-served-persons.md rule 28 — a per-person SAS sale sent with `units` and no `persons`, by a tab still
// running the previous bundle (audit R21-P1, C4, R21-L5). Pure, then through the real resolver.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const { priceOptionSale } = require('../utils/sasOptionSale');
const { todayIso } = require('../utils/localDate');
const { addIsoDays } = require('../utils/occupancy');

const legacy = (priceType, over = {}) => priceOptionSale({ id: 9, price: 20, priceType, showsPlanningCard: 0 }, {
  persons: 5, nights: 2, maxPersons: 6, ...over,
});

test('rule 28 — a per-person sale sent with units only reads as the people served, quantity 1', () => {
  const line = legacy('per_person', { units: 3 });
  assert.equal(line.quantity, 1);
  assert.equal(line.cardPersons, 3);
  assert.equal(line.billedUnits, 3);
  assert.equal(line.totalPrice, 60);
});

test('rule 28 — per person per night: the units are divided by the nights, never by the party', () => {
  const line = legacy('per_person_per_night', { units: 6 });
  assert.equal(line.quantity, 1);
  assert.equal(line.cardPersons, 3);
  assert.equal(line.billedUnits, 6);
  assert.equal(line.totalPrice, 120);
});

test('rule 28 — never a decimal: a remainder is not billed, and at least one person is served', () => {
  const line = legacy('per_person_per_night', { units: 5 });
  assert.equal(line.cardPersons, 2);
  assert.equal(line.billedUnits, 4);
  const one = legacy('per_person', { units: 0.5 });
  assert.equal(one.cardPersons, 1);
  assert.equal(one.quantity, 1);
});

test('rule 28 — the old default (the whole party) stays NULL and follows the party', () => {
  const line = legacy('per_person', { units: 5 });
  assert.equal(line.cardPersons, null);
  assert.equal(line.billedUnits, 5);
});

test('rule 28 — a stay with no night bills nothing, and never divides by zero', () => {
  assert.equal(legacy('per_person_per_night', { units: 3, nights: 0 }), null);
});

test('rule 28 — persons wins over units; no units and no persons is the party, as before', () => {
  assert.equal(legacy('per_person', { units: 2, servedPersons: 4 }).cardPersons, 4);
  const party = legacy('per_person', {});
  assert.equal(party.cardPersons, null);
  assert.equal(party.billedUnits, 5);
});

test('rule 28 — a units-only sale on any other price type is unchanged', () => {
  const night = legacy('per_night', { units: 3 });
  assert.equal(night.cardNights, 3);
  assert.equal(night.billedUnits, 3);
  const flat = legacy('per_stay', { units: 2 });
  assert.equal(flat.quantity, 2);
  assert.equal(flat.billedUnits, 2);
});

test('rule 28 — through the real resolver: a stale tab sells 3 meals, not the party', () => {
  db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Granja', 6)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Test', 'Sas')").run();
  db.prepare("INSERT INTO options (id, title, price, priceType, category) VALUES (203, 'Panier', 8, 'per_person', 'Restauration')").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 203)').run();
  const start = todayIso();
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, platform, totalPrice, finalPrice, kind)
      VALUES (1, 1, ?, ?, 4, 'direct', 100, 100, 'reservation')`).run(start, addIsoDays(start, 2)).lastInsertRowid);
  const [line] = model.resolveSasOptionSales(id, [{ optionId: 203, units: 3 }]);
  assert.equal(line.billedUnits, 3);
  assert.equal(line.cardPersons, 3);
  assert.equal(line.quantity, 1);
  assert.equal(line.totalPrice, 24);
});
