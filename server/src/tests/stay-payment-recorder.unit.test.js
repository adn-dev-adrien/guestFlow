// specs/plugins-phase-3a-online-payment.md rules 1–3 — one way to record a stay payment. A deposit ticked
// by hand and the same deposit received through a provider's link leave the same rows: flag, date,
// contribs captured, the SAS's hold on the bucket released.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const reservationsModelModule = require('../models/reservationsModel');
const { recordStayPayment } = require('../utils/stayPaymentRecorder');
const { applyPaidEffect } = require('../utils/paymentPollRunner');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (1, 'Standard', 100, 1)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  return db;
}

// Two nights at 100 €: 200 €, a 60 € acompte and a 140 € solde.
function addStay(db, { propertyId = 1 } = {}) {
  return Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
      finalPrice, totalPrice, depositAmount, balanceAmount, platform, updatedAt)
    VALUES ('reservation', ?, 1, '2026-11-10', '2026-11-12', 2, 200, 200, 60, 140, 'direct', '2000-01-01 00:00:00')`).run(propertyId).lastInsertRowid);
}

function depsOn(db, events = []) {
  return {
    db,
    reservationsModel: reservationsModelModule.create(db),
    emit: (name, payload) => events.push([name, payload]),
  };
}

const moneyRow = (db, id) => db.prepare(`SELECT depositPaid, depositPaidDate, balancePaid, balancePaidDate,
  accommodationAcompteContribTtc, accommodationSoldeContribTtc, updatedAt FROM reservations WHERE id = ?`).get(id);

test('rule 1 — a deposit received online leaves the same rows as the same deposit ticked by hand', () => {
  const db = seed();
  const byHand = addStay(db);
  const online = addStay(db);

  recordStayPayment(depsOn(db), { reservationId: byHand, bucket: 'deposit', paidDate: '2026-10-01' });
  const recordPayment = (payment) => recordStayPayment(depsOn(db), { ...payment, paidDate: '2026-10-01', keepPaymentOnCaptureFailure: true });
  const effect = applyPaidEffect({ database: db, devisModel: {}, link: { reservationId: online, type: 'deposit' }, recordPayment });

  assert.equal(effect.effect, 'deposit-marked');
  const a = moneyRow(db, byHand);
  const b = moneyRow(db, online);
  assert.equal(a.depositPaid, 1);
  assert.equal(a.depositPaidDate, '2026-10-01');
  assert.equal(a.accommodationAcompteContribTtc, 60, 'the acompte is split onto the stay');
  assert.notEqual(a.updatedAt, '2000-01-01 00:00:00');
  const { updatedAt: _a, ...restA } = a;
  const { updatedAt: _b, ...restB } = b;
  assert.deepEqual(restB, restA);
});

test('rule 1 — a full payment records the deposit, then the balance, each with its capture', () => {
  const db = seed();
  const id = addStay(db);
  const { flipped } = recordStayPayment(depsOn(db), { reservationId: id, bucket: 'full', paidDate: '2026-10-02' });
  assert.deepEqual(flipped, ['deposit', 'balance']);
  const row = moneyRow(db, id);
  assert.equal(row.depositPaid, 1);
  assert.equal(row.balancePaid, 1);
  assert.equal(row.balancePaidDate, '2026-10-02');
  assert.equal(row.accommodationAcompteContribTtc, 60);
  assert.equal(row.accommodationSoldeContribTtc, 140);
});

test('rule 1 — a bucket already paid is left as it is: a replay records nothing twice', () => {
  const db = seed();
  const id = addStay(db);
  const events = [];
  recordStayPayment(depsOn(db, events), { reservationId: id, bucket: 'deposit', paidDate: '2026-10-01' });
  const again = recordStayPayment(depsOn(db, events), { reservationId: id, bucket: 'deposit', paidDate: '2026-10-05' });
  assert.deepEqual(again.flipped, []);
  assert.equal(moneyRow(db, id).depositPaidDate, '2026-10-01');
  assert.equal(events.length, 1, 'reservation.paid once');
});

test('rule 1 — a failed capture ticks nothing by hand, but never loses money already received', () => {
  const db = seed();
  // A solde captured before its acompte breaks the conservation invariant: the capture throws.
  const byHand = addStay(db);
  const online = addStay(db);

  assert.throws(() => recordStayPayment(depsOn(db), { reservationId: byHand, bucket: 'balance' }), /Conservation invariant/);
  assert.equal(moneyRow(db, byHand).balancePaid, 0, 'the manual tick rolled back');

  const result = recordStayPayment(depsOn(db), { reservationId: online, bucket: 'balance', keepPaymentOnCaptureFailure: true });
  assert.deepEqual(result.flipped, ['balance']);
  assert.deepEqual(result.captureFailed, ['balance']);
  const row = moneyRow(db, online);
  assert.equal(row.balancePaid, 1, 'the guest paid: the stay says so');
  assert.equal(row.accommodationSoldeContribTtc, null, 'and no half-written contribs');
});

// Since specs/plugins-phase-3b-neat.md rule 9 the event is the only follow-up: Neat listens to it.
test('rules 2–3 — a recorded payment emits reservation.paid once', () => {
  const db = seed();
  const id = addStay(db);
  const events = [];
  recordStayPayment(depsOn(db, events), { reservationId: id, bucket: 'deposit' });
  assert.deepEqual(events, [['reservation.paid', { reservationId: id, bucket: 'deposit' }]]);
});
