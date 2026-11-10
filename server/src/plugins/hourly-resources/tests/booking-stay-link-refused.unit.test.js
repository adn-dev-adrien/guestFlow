// specs/resource-booking-pricing-and-invoicing.md rule 46 (audit R36-DB-L2) — a resource booking is a sale outside any
// stay: no screen links one to a stay, and money taken on such a link was booked nowhere (standaloneSales skips it, the
// stay's books never read it). A `reservationId` in a create or an update body is refused before anything is written; a
// stored link sent back unchanged passes, and a row stored with a link takes no payment.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, DAY } = require('./standaloneBookingFixture');

const draft = (resourceId, extra = {}) => ({ resourceId, date: DAY, startTime: '18:00', endTime: '20:00', clientName: 'Ana Lune', ...extra });
const count = (db) => db.prepare('SELECT COUNT(*) c FROM resource_bookings').get().c;
const card = (cents) => [{ method: 'card', amountCents: cents, internal: false }];

test('rule 46 — a create naming a stay is refused 400, nothing stored', () => {
  const { db, model, resourceId } = seed();
  db.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY)');
  db.prepare('INSERT INTO reservations (id) VALUES (7)').run();
  for (const reservationId of [7, '7', 999]) {
    const res = model.createBooking(draft(resourceId, { reservationId }));
    assert.equal(res.status, 400, JSON.stringify(reservationId));
    assert.equal(res.code, 'BOOKING_STAY_LINK');
    assert.equal(res.error, 'Séance hors séjour : aucune réservation à lier.');
  }
  assert.equal(count(db), 0);
  [undefined, null, ''].forEach((reservationId, i) => {
    const slot = { startTime: `1${i * 2}:00`, endTime: `1${i * 2 + 1}:00` };
    assert.equal(model.createBooking(draft(resourceId, { reservationId, ...slot })).ok, true, JSON.stringify(reservationId));
  });
});

test('rule 46 — an update linking a booking to a stay is refused, a stored link sent back unchanged passes', () => {
  const { db, model, resourceId } = seed();
  const id = book(model, resourceId);
  const res = model.update(id, { reservationId: 7 });
  assert.equal(res.status, 400);
  assert.equal(res.code, 'BOOKING_STAY_LINK');
  assert.equal(db.prepare('SELECT reservationId FROM resource_bookings WHERE id = ?').get(id).reservationId, null);
  db.prepare('UPDATE resource_bookings SET reservationId = 7 WHERE id = ?').run(id);
  assert.equal(model.update(id, { reservationId: 7, notes: 'Note' }).ok, true);
});

test('rule 46 — a row stored with a stay link takes no payment: 409 BOOKING_HAS_STAY, nothing recorded', () => {
  const { db, model, resourceId } = seed();
  const id = book(model, resourceId);
  db.prepare('UPDATE resource_bookings SET reservationId = 7 WHERE id = ?').run(id);
  const res = model.recordPayment(id, { tenders: card(12000), paidAt: DAY });
  assert.equal(res.status, 409);
  assert.equal(res.code, 'BOOKING_HAS_STAY');
  assert.equal(db.prepare('SELECT paid FROM resource_bookings WHERE id = ?').get(id).paid, 0);
});
