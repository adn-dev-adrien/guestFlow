// specs/devis-accept-to-reservation.md rule 9 — turning a devis into a stay checks the dates.
// A devis never blocks them, so the sale of the same nights elsewhere while the quote waited went
// through unnoticed (audit 2026-10-28). The refusal lives in the model so every caller gets it; the
// paid-link path keeps converting (the money is in) and flags the clash.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const reservationsModel = require('../models/reservationsModel');
const { buildController: createController } = require('../controllers/devisController');
const { runPaymentPoll } = require('../utils/paymentPollRunner');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ bookedElsewhere = true } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  if (bookedElsewhere) {
    db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType)
                VALUES ('reservation', 1, 1, '2027-03-10', '2027-03-14', 'Airbnb', 'ical')`).run();
  }
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
                            finalPrice, depositAmount, balanceAmount, devisStatus)
                           VALUES ('devis', 1, 1, '2027-03-11', '2027-03-13', 2, 300, 90, 210, 'sent')`).run();
  return { db, devisId: Number(info.lastInsertRowid) };
}

const stays = (db) => db.prepare("SELECT COUNT(*) c FROM reservations WHERE kind = 'reservation'").get().c;

test('rule 9 — a manual conversion over dates another stay now holds is refused (409), nothing is created', () => {
  const { db, devisId } = seed();
  const result = devisModel.buildModel(db).convertToReservation(devisId);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'DATES_UNAVAILABLE');
  assert.match(result.error, /déjà réservé/);
  assert.equal(stays(db), 1);
  const devis = db.prepare('SELECT devisStatus, convertedReservationId FROM reservations WHERE id = ?').get(devisId);
  assert.equal(devis.devisStatus, 'sent');
  assert.equal(devis.convertedReservationId, null);
});

test('rule 9 — the HTTP answer is the model\'s 409 with its French message and code', () => {
  const { db, devisId } = seed();
  const controller = createController(devisModel.buildModel(db), { emitPluginEvent: () => { throw new Error('no event on a refusal'); } });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.convertToReservation({ params: { id: devisId } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'DATES_UNAVAILABLE');
  assert.match(res.body.error, /réservé/);
});

test('rule 9 — free dates convert as before', () => {
  const { db, devisId } = seed({ bookedElsewhere: false });
  const result = devisModel.buildModel(db).convertToReservation(devisId);
  assert.equal(result.ok, true);
  assert.equal(stays(db), 1);
});

test('rule 9 — a closure over the dates refuses the conversion too', () => {
  const { db, devisId } = seed({ bookedElsewhere: false });
  const closures = require('../models/establishmentClosuresModel');
  const original = closures.findCoveringClosure;
  closures.findCoveringClosure = () => ({ label: 'Travaux', startDate: '2027-03-01', endDate: '2027-03-20' });
  try {
    const result = devisModel.buildModel(db).convertToReservation(devisId);
    assert.equal(result.status, 409);
  } finally {
    closures.findCoveringClosure = original;
  }
});

test('rule 9 — the paid-link path keeps converting over taken dates and flags the conflict', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: devisId, type: 'deposit', amountCents: 9000, providerLinkId: 'ql_1', url: 'u', status: 'open' });
  const notified = [];
  await runPaymentPoll({
    database: db,
    paymentLinksModel: links,
    devisModel: devisModel.buildModel(db),
    provider: {
      id: 'qonto',
      getPayment: async () => ({ paid: true, paymentId: 'p1', paidAt: '2027-02-01T10:00:00Z' }),
      getLinkStatus: async () => 'processing',
      cancelLink: async () => {},
    },
    checkConflict: ({ reservationId }) => {
      const r = db.prepare('SELECT propertyId, startDate, endDate, checkInTime, checkOutTime FROM reservations WHERE id = ?').get(reservationId);
      return Boolean(reservationsModel.create(db).validateAvailability(r.propertyId, r.startDate, r.endDate, r.checkInTime, r.checkOutTime, reservationId, {}, { allowPastDates: true }));
    },
    notifyConflict: (id) => { notified.push(id); },
  });
  const converted = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(devisId).convertedReservationId;
  assert.ok(converted, 'the money is in: the stay exists');
  assert.ok(db.prepare('SELECT bookingConflictAt FROM reservations WHERE id = ?').get(converted).bookingConflictAt);
  assert.deepEqual(notified, [converted]);
});
