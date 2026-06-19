const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

// specs/reservation-number-and-search.md §3 rules 1-5 — the model assigns / overrides / validates the
// reservation number. Uses the real schema (schema.sql) + the reservationNumber column the boot
// migration adds, so the heavy insert/update SQL runs against a faithful table.

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function freshModel() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  db.exec('CREATE UNIQUE INDEX ux_reservations_reservationNumber ON reservations(reservationNumber) WHERE reservationNumber IS NOT NULL');
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { db, model: reservationsModel.create(db) };
}

const QUOTE = {
  totalPrice: 300, touristTaxRate: 0, touristTaxTotal: 0, discountPercent: 0, finalPrice: 300,
  depositAmount: 0, depositDueDate: null, balanceAmount: 300, balanceDueDate: null, complementAmount: 0,
};
const NIGHT_BLOCKS = { blocksPreviousNight: 0, blocksNextNight: 0 };

function basePayload(over = {}) {
  return {
    propertyId: 1, clientId: 1, startDate: '2026-09-10', endDate: '2026-09-13',
    adults: 2, platform: 'direct', ...over,
  };
}

test('insertReservation generates a AAAAMM### number when none is supplied', () => {
  const { model } = freshModel();
  const id = model.insertReservation(basePayload(), QUOTE, NIGHT_BLOCKS);
  assert.match(model.getReservationNumber(id), /^\d{6}001$/);
});

test('insertReservation increments the per-month sequence', () => {
  const { model } = freshModel();
  const id1 = model.insertReservation(basePayload(), QUOTE, NIGHT_BLOCKS);
  const id2 = model.insertReservation(basePayload(), QUOTE, NIGHT_BLOCKS);
  const n1 = model.getReservationNumber(id1);
  const n2 = model.getReservationNumber(id2);
  assert.match(n1, /001$/);
  assert.match(n2, /002$/);
  assert.equal(n1.slice(0, 6), n2.slice(0, 6), 'same month prefix (AAAAMM)');
});

test('insertReservation honours an operator override (stored verbatim, trimmed)', () => {
  const { model } = freshModel();
  const id = model.insertReservation(basePayload({ reservationNumber: '  RES-PERSO-9  ' }), QUOTE, NIGHT_BLOCKS);
  assert.equal(model.getReservationNumber(id), 'RES-PERSO-9');
});

test('updateReservation with a blank number keeps the existing one', () => {
  const { model } = freshModel();
  const id = model.insertReservation(basePayload(), QUOTE, NIGHT_BLOCKS);
  const before = model.getReservationNumber(id);
  model.updateReservation(id, basePayload({ reservationNumber: '' }), QUOTE, NIGHT_BLOCKS, 0);
  assert.equal(model.getReservationNumber(id), before, 'unchanged');
});

test('updateReservation override replaces the number', () => {
  const { model } = freshModel();
  const id = model.insertReservation(basePayload(), QUOTE, NIGHT_BLOCKS);
  model.updateReservation(id, basePayload({ reservationNumber: '2099-01-777' }), QUOTE, NIGHT_BLOCKS, 0);
  assert.equal(model.getReservationNumber(id), '2099-01-777');
});

test('devis→reservation conversion generates a number on the next save (kind=reservation, none yet)', () => {
  const { db, model } = freshModel();
  // A converted devis: kind already flipped to 'reservation', still numberless (devis carry devisNumber).
  const info = db.prepare(
    "INSERT INTO reservations (kind, devisNumber, propertyId, clientId, startDate, endDate, totalPrice, finalPrice) VALUES ('reservation', '2026-09-005', 1, 1, '2026-09-10', '2026-09-13', 300, 300)",
  ).run();
  const id = info.lastInsertRowid;
  assert.equal(model.getReservationNumber(id), '', 'no number yet');
  model.updateReservation(id, basePayload(), QUOTE, NIGHT_BLOCKS, 0);
  assert.match(model.getReservationNumber(id), /^\d{6}001$/, 'generated on save');
});

test('isReservationNumberTaken: true for a duplicate, false for self (exceptId) and unknown', () => {
  const { model } = freshModel();
  const id = model.insertReservation(basePayload({ reservationNumber: '2026-09-050' }), QUOTE, NIGHT_BLOCKS);
  assert.equal(model.isReservationNumberTaken('2026-09-050'), true);
  assert.equal(model.isReservationNumberTaken('2026-09-050', id), false, 'excludes self');
  assert.equal(model.isReservationNumberTaken('2026-09-999'), false);
  assert.equal(model.isReservationNumberTaken(''), false);
});
