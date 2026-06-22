const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

// specs/platform-commission-line.md — the operator-entered platform commission is persisted on
// `reservations.platformCommissionAmount`: stored (clamped ≥ 0) for non-direct platforms, NULL for
// direct bookings (no commission). This locks the round-trip so the fiche « net perçu » survives a save.

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function freshModel() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
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
  return { propertyId: 1, clientId: 1, startDate: '2026-09-10', endDate: '2026-09-13', adults: 2, platform: 'direct', ...over };
}

const readCommission = (db, id) => db.prepare('SELECT platformCommissionAmount FROM reservations WHERE id = ?').get(id).platformCommissionAmount;

test('platform reservation: entered commission is persisted', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'Airbnb', platformCommissionAmount: 35 }), QUOTE, NIGHT_BLOCKS);
  assert.equal(readCommission(db, id), 35);
});

test('platform reservation: a negative commission is clamped to 0', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'Airbnb', platformCommissionAmount: -10 }), QUOTE, NIGHT_BLOCKS);
  assert.equal(readCommission(db, id), 0);
});

test('platform reservation: an empty commission is stored as NULL', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'Airbnb', platformCommissionAmount: '' }), QUOTE, NIGHT_BLOCKS);
  assert.equal(readCommission(db, id), null);
});

test('direct reservation: commission is forced to NULL even when a value is supplied', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'direct', platformCommissionAmount: 35 }), QUOTE, NIGHT_BLOCKS);
  assert.equal(readCommission(db, id), null);
});

test('updateReservation persists a new commission value', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'Airbnb', platformCommissionAmount: 35 }), QUOTE, NIGHT_BLOCKS);
  model.updateReservation(id, basePayload({ platform: 'Airbnb', platformCommissionAmount: 50 }), QUOTE, NIGHT_BLOCKS, 0);
  assert.equal(readCommission(db, id), 50);
});

test('switching a reservation to direct clears the commission', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'Airbnb', platformCommissionAmount: 35 }), QUOTE, NIGHT_BLOCKS);
  model.updateReservation(id, basePayload({ platform: 'direct', platformCommissionAmount: 35 }), QUOTE, NIGHT_BLOCKS, 0);
  assert.equal(readCommission(db, id), null);
});

// specs/platform-payment-entry.md — brut (pins the total) + virement (reconciliation) round-trip.
const readGross = (db, id) => db.prepare('SELECT platformGrossAmount FROM reservations WHERE id = ?').get(id).platformGrossAmount;
const readPayout = (db, id) => db.prepare('SELECT platformPayoutAmount FROM reservations WHERE id = ?').get(id).platformPayoutAmount;

test('platform: brut + virement are persisted (clamped ≥ 0)', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'Gîtes de France', platformGrossAmount: 687, platformPayoutAmount: 626 }), QUOTE, NIGHT_BLOCKS);
  assert.equal(readGross(db, id), 687);
  assert.equal(readPayout(db, id), 626);
});

test('platform: empty brut/virement → NULL', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'Airbnb', platformGrossAmount: '', platformPayoutAmount: '' }), QUOTE, NIGHT_BLOCKS);
  assert.equal(readGross(db, id), null);
  assert.equal(readPayout(db, id), null);
});

test('direct: brut/virement forced to NULL even when supplied', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'direct', platformGrossAmount: 687, platformPayoutAmount: 626 }), QUOTE, NIGHT_BLOCKS);
  assert.equal(readGross(db, id), null);
  assert.equal(readPayout(db, id), null);
});

test('updateReservation persists new brut + virement; switching to direct clears them', () => {
  const { db, model } = freshModel();
  const id = model.insertReservation(basePayload({ platform: 'Airbnb', platformGrossAmount: 100, platformPayoutAmount: 90 }), QUOTE, NIGHT_BLOCKS);
  model.updateReservation(id, basePayload({ platform: 'Airbnb', platformGrossAmount: 120, platformPayoutAmount: 110 }), QUOTE, NIGHT_BLOCKS, 0);
  assert.equal(readGross(db, id), 120);
  assert.equal(readPayout(db, id), 110);
  model.updateReservation(id, basePayload({ platform: 'direct', platformGrossAmount: 120, platformPayoutAmount: 110 }), QUOTE, NIGHT_BLOCKS, 0);
  assert.equal(readGross(db, id), null);
  assert.equal(readPayout(db, id), null);
});
