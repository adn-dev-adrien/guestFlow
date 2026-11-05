// specs/reservations-backend-mvc.md rule 21 (audit R23-4) — the cots and the per-stay resources held on a range are the
// peak of one night, not the sum of every stay touching the range: two stays that never meet hold their stock in turn.
// One function, read by the two cot counts and the two resource counts.
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const reservationsModel = require('../models/reservationsModel');
const resourcesModel = require('../models/resourcesModel');
const controller = require('../controllers/reservationsController');
const { peakPerNight } = require('../utils/stockPeak');

const day = (n) => inDays(60 + n);

function cleanSlate() {
  db.prepare('DELETE FROM reservations').run();
  db.prepare('DELETE FROM resources').run();
}

function cots(quantity = 3) {
  cleanSlate();
  db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', ?, 0, 'free')").run(quantity);
}

const cotStay = (count, from, to, extra = {}) => addStay({
  propertyId: freshProperty(), start: day(from), end: day(to), extra: { babies: count, babyBeds: count, ...extra },
});

function bikes(quantity = 3) {
  cleanSlate();
  return Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Vélo', ?, 10, 'per_stay')").run(quantity).lastInsertRowid);
}

function bikeStay(resourceId, count, from, to, { kind = 'reservation' } = {}) {
  const id = addStay({ propertyId: freshProperty(), kind, start: day(from), end: day(to) });
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity) VALUES (?, ?, ?)').run(id, resourceId, count);
  return id;
}

// Every count must answer the same number: the fiche's hint and the save's refusal read different models.
function cotsLeft(from, to, excludeId = null) {
  const propertyId = freshProperty();
  const save = reservationsModel.getBabyBedAvailability(propertyId, day(from), day(to), excludeId);
  const hint = resourcesModel.getBabyBedAvailability(propertyId, day(from), day(to), excludeId).available;
  assert.equal(save, hint, 'the save and the hint disagree');
  return save;
}

function bikesHeld(resourceId, from, to, excludeId = null) {
  const save = reservationsModel.getResourceReservedQuantity(resourceId, day(from), day(to), excludeId);
  const row = resourcesModel.availability(null, day(from), day(to), excludeId).find((r) => r.id === resourceId);
  assert.equal(save, row.reserved, 'the save and the hint disagree');
  return save;
}

test('rule 21 — two stays that never meet hold the peak of one, not their sum', () => {
  cots();
  cotStay(2, 3, 5);
  cotStay(2, 6, 8);
  assert.equal(cotsLeft(3, 8), 1);
});

test('rule 21 — stays that meet on a night add up on it', () => {
  cots();
  cotStay(1, 3, 6);
  cotStay(2, 5, 8);
  assert.equal(cotsLeft(3, 8), 0);
});

test('rule 21 — a stay leaving the day another arrives shares no night', () => {
  cots();
  cotStay(2, 3, 5);
  cotStay(2, 5, 8);
  assert.equal(cotsLeft(3, 8), 1);
});

test('rule 21 — a night outside the range does not count, even when the stays met on it', () => {
  cots();
  cotStay(2, 1, 5);
  cotStay(1, 3, 10);
  assert.equal(cotsLeft(5, 8), 2);
  assert.equal(cotsLeft(4, 8), 0);
});

test('rule 21 — a stay starting inside the range, on top of one already there, reaches the peak', () => {
  cots();
  cotStay(1, 1, 10);
  cotStay(2, 5, 7);
  assert.equal(cotsLeft(3, 8), 0);
  assert.equal(cotsLeft(7, 8), 2);
});

test('rule 21 — the excluded stay holds nothing, a devis and a cancelled stay neither', () => {
  cots();
  const mine = cotStay(3, 3, 5);
  addStay({ propertyId: freshProperty(), kind: 'devis', start: day(3), end: day(5), extra: { babies: 3, babyBeds: 3 } });
  addStay({ propertyId: freshProperty(), kind: 'cancelled', start: day(3), end: day(5), extra: { babies: 3, babyBeds: 3 } });
  assert.equal(cotsLeft(3, 5), 0);
  assert.equal(cotsLeft(3, 5, mine), 3);
});

test('rule 21 — a cot scoped to its logement counts only that logement, night by night', () => {
  cleanSlate();
  const mine = freshProperty();
  const cot = Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 2, 0, 'free')").run().lastInsertRowid);
  db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, ?)').run(cot, mine);
  addStay({ propertyId: mine, start: day(3), end: day(5), extra: { babies: 2, babyBeds: 2 } });
  addStay({ propertyId: freshProperty(), start: day(3), end: day(5), extra: { babies: 2, babyBeds: 2 } });
  addStay({ propertyId: mine, start: day(6), end: day(8), extra: { babies: 1, babyBeds: 1 } });
  assert.equal(reservationsModel.getBabyBedAvailability(mine, day(3), day(8), null), 0);
  assert.deepEqual(resourcesModel.getBabyBedAvailability(mine, day(6), day(8), null), { totalQuantity: 2, reserved: 1, available: 1 });
});

test('rule 21 — a per-stay resource reads the same peak on the save and on the availability', () => {
  const bike = bikes();
  bikeStay(bike, 2, 3, 5);
  bikeStay(bike, 2, 6, 8);
  addStay({ propertyId: freshProperty(), start: day(3), end: day(8) });
  assert.equal(bikesHeld(bike, 3, 8), 2);
  const met = bikeStay(bike, 1, 4, 7);
  assert.equal(bikesHeld(bike, 3, 8), 3);
  assert.equal(bikesHeld(bike, 3, 8, met), 2);
  bikeStay(bike, 3, 3, 5, { kind: 'devis' });
  assert.equal(bikesHeld(bike, 3, 8), 3);
});

test('rule 21 — the pure peak: no row, one row, a range of no night', () => {
  const range = [day(0), day(4)];
  assert.equal(peakPerNight([], ...range), 0);
  assert.equal(peakPerNight([{ startDate: day(1), endDate: day(2), count: 5 }], ...range), 5);
  assert.equal(peakPerNight([{ startDate: day(1), endDate: day(2), count: null }], ...range), 0);
  assert.equal(peakPerNight([{ startDate: day(5), endDate: day(6), count: 5 }], ...range), 0);
  assert.equal(peakPerNight([{ startDate: day(-1), endDate: day(6), count: 5 }], day(2), day(2)), 5);
});

function createBody(propertyId, from, to, babyBeds) {
  return {
    propertyId, clientId: 1, startDate: day(from), endDate: day(to), checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults: 2, children: 0, teens: 0, babies: babyBeds, babyBeds, customPrice: 300,
    forceMinNights: true, forceMaxNights: true, forceChangeover: true, forceCapacity: true,
  };
}

async function post(body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.create({ query: {}, params: {}, user: { roles: ['admin'] }, body }, res);
  return res;
}

test('rule 21 — the save follows: a long stay across two that never meet is accepted, a fourth at once is not', async () => {
  cots();
  cotStay(2, 3, 5);
  cotStay(2, 6, 8);
  const across = await post(createBody(freshProperty(), 3, 8, 1));
  assert.ok(across.statusCode < 300, JSON.stringify(across.body));
  const fourth = await post(createBody(freshProperty(), 3, 5, 1));
  assert.equal(fourth.statusCode, 400);
  assert.match(fourth.body.error, /Lits bébé indisponibles: 0 restant/);
});
