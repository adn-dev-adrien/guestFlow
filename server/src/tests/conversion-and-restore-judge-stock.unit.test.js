// specs/devis-accept-to-reservation.md rule 10 and specs/calendar-property-parity.md rule 31 (audit R23-1) — a devis holds
// no stock and a duplicate set aside neither, so the conversion and « Rétablir » are where the cots and the per-stay
// resources are judged, on the peak of reservations-backend-mvc rule 21. The paid-link path keeps converting; a stored
// oversold fiche keeps saving (reservations-backend-mvc rule 17).
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const devisModel = require('../models/devisModel');
const { buildController } = require('../controllers/devisController');
const reservationsController = require('../controllers/reservationsController');

const FROM = inDays(60);
const TO = inDays(63);

function cleanSlate() {
  db.prepare('DELETE FROM reservations').run();
  db.prepare('DELETE FROM resources').run();
}

function cotsAllTaken() {
  cleanSlate();
  db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 3, 0, 'free')").run();
  addStay({ propertyId: freshProperty(), start: FROM, end: TO, extra: { babies: 3, babyBeds: 3 } });
}

function resource(priceType = 'per_stay', quantity = 1) {
  return Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Vélo', ?, 10, ?)").run(quantity, priceType).lastInsertRowid);
}

const holdResource = (reservationId, resourceId, quantity = 1, priceType = 'per_stay') => db.prepare(
  'INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType) VALUES (?, ?, ?, ?)',
).run(reservationId, resourceId, quantity, priceType);

function resourceAllTaken(priceType = 'per_stay') {
  cleanSlate();
  const id = resource(priceType);
  holdResource(addStay({ propertyId: freshProperty(), start: FROM, end: TO }), id, 1, priceType);
  return id;
}

const devis = (extra = {}) => addStay({ propertyId: freshProperty(), kind: 'devis', start: FROM, end: TO, extra });
const setAside = (extra = {}) => addStay({ propertyId: freshProperty(), kind: 'superseded', start: FROM, end: TO, extra });

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function convert(id) {
  const res = fakeRes();
  buildController(devisModel.buildModel(db), { emitPluginEvent: () => {} }).convertToReservation({ params: { id } }, res);
  return res;
}

function restore(id) {
  const res = fakeRes();
  reservationsController.restoreSuperseded({ params: { id: String(id) }, user: { email: 'admin@example.test' } }, res);
  return res;
}

const reservationCount = () => db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'reservation'").get().n;
const row = (id) => db.prepare('SELECT kind, devisStatus, convertedReservationId FROM reservations WHERE id = ?').get(id);

test('rule 10 — a devis with a cot past the stock is refused, 409, and nothing is written', () => {
  cotsAllTaken();
  const id = devis({ babies: 1, babyBeds: 1 });
  const before = row(id);
  const count = reservationCount();
  const res = convert(id);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'STOCK_UNAVAILABLE');
  assert.match(res.body.error, /Lits bébé indisponibles: 0 restant\(s\) pour cette période/);
  assert.equal(reservationCount(), count);
  assert.deepEqual(row(id), before);
});

test('rule 10 — a devis with a per-stay resource past the stock is refused, 409, and nothing is written', () => {
  const bike = resourceAllTaken();
  const id = devis();
  holdResource(id, bike);
  const before = row(id);
  const count = reservationCount();
  const res = convert(id);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'STOCK_UNAVAILABLE');
  assert.match(res.body.error, /Ressource 'Vélo' indisponible: 0 restant\(s\) pour cette période/);
  assert.equal(reservationCount(), count);
  assert.deepEqual(row(id), before);
});

test('rule 10 — the stock left converts: a cot still free, a resource still free, no line at all', () => {
  cotsAllTaken();
  assert.equal(convert(devis()).statusCode, 200);
  cleanSlate();
  db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 2, 0, 'free')").run();
  const bike = resource('per_stay', 2);
  holdResource(addStay({ propertyId: freshProperty(), start: FROM, end: TO, extra: { babies: 1, babyBeds: 1 } }), bike);
  const id = devis({ babies: 1, babyBeds: 1 });
  holdResource(id, bike);
  const res = convert(id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('rule 10 — stays that never meet leave the stock free for the devis across them, night by night', () => {
  cleanSlate();
  db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 3, 0, 'free')").run();
  addStay({ propertyId: freshProperty(), start: inDays(60), end: inDays(62), extra: { babies: 2, babyBeds: 2 } });
  addStay({ propertyId: freshProperty(), start: inDays(63), end: inDays(65), extra: { babies: 2, babyBeds: 2 } });
  const id = addStay({ propertyId: freshProperty(), kind: 'devis', start: inDays(60), end: inDays(65), extra: { babies: 1, babyBeds: 1 } });
  assert.equal(convert(id).statusCode, 200);
});

test('rule 10 — an hourly resource is no stock: it never refuses the conversion', () => {
  const sauna = resourceAllTaken('per_hour');
  const id = devis();
  holdResource(id, sauna, 1, 'per_hour');
  assert.equal(convert(id).statusCode, 200);
});

test('rule 10 — a stored party smaller than its cots is not this guard\'s business: only the stock is judged', () => {
  cleanSlate();
  db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 3, 0, 'free')").run();
  assert.equal(convert(devis({ babies: 0, babyBeds: 2 })).statusCode, 200);
});

test('rule 10 — taken dates keep their own refusal, ahead of the stock', () => {
  cotsAllTaken();
  const propertyId = freshProperty();
  addStay({ propertyId, start: FROM, end: TO });
  const id = addStay({ propertyId, kind: 'devis', start: FROM, end: TO, extra: { babies: 1, babyBeds: 1 } });
  const res = convert(id);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'DATES_UNAVAILABLE');
});

test('rule 10 — the paid-link path keeps converting past the stock (allowConflict)', () => {
  const bike = resourceAllTaken();
  db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 1, 0, 'free')").run();
  addStay({ propertyId: freshProperty(), start: FROM, end: TO, extra: { babies: 1, babyBeds: 1 } });
  const id = devis({ babies: 1, babyBeds: 1 });
  holdResource(id, bike);
  const result = devisModel.buildModel(db).convertToReservation(id, { allowConflict: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  const stay = db.prepare('SELECT babyBeds FROM reservations WHERE id = ?').get(result.data.reservationId);
  assert.equal(stay.babyBeds, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = ?').get(result.data.reservationId).n, 1);
});

test('specs/calendar-property-parity.md rule 31 — « Rétablir » with a cot past the stock is refused, 409, the stay stays set aside', () => {
  cotsAllTaken();
  const id = setAside({ babies: 1, babyBeds: 1 });
  const res = restore(id);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'STOCK_UNAVAILABLE');
  assert.match(res.body.error, /Lits bébé indisponibles: 0 restant/);
  assert.equal(row(id).kind, 'superseded');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ? AND eventType = 'unsuperseded'").get(id).n, 0);
});

test('specs/calendar-property-parity.md rule 31 — « Rétablir » with a per-stay resource past the stock is refused, 409', () => {
  const bike = resourceAllTaken();
  const id = setAside();
  holdResource(id, bike);
  const res = restore(id);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.match(res.body.error, /Ressource 'Vélo' indisponible: 0 restant/);
  assert.equal(row(id).kind, 'superseded');
});

test('specs/calendar-property-parity.md rule 31 — « Rétablir » with the stock free goes through, its own lines not counted against it', () => {
  cleanSlate();
  db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 1, 0, 'free')").run();
  const bike = resource('per_stay', 1);
  const id = setAside({ babies: 1, babyBeds: 1 });
  holdResource(id, bike);
  const res = restore(id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(row(id).kind, 'reservation');
});

test('specs/calendar-property-parity.md rule 31 — taken dates still answer « Ces dates sont déjà prises. »', () => {
  cotsAllTaken();
  const propertyId = freshProperty();
  addStay({ propertyId, start: FROM, end: TO });
  const id = addStay({ propertyId, kind: 'superseded', start: FROM, end: TO, extra: { babies: 1, babyBeds: 1 } });
  const res = restore(id);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'Ces dates sont déjà prises.');
});
