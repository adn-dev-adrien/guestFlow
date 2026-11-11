// specs/payment-link-lifecycle.md rules 38, 39 (§9 Q9) — the platform is the authority on its own booking: an iCal
// stay on nights another stay holds is still recorded, stamped `bookingConflictAt`, and the alert calls it an
// over-booking, naming the stay that holds the nights. Approving an iCal date drift onto held nights is warned first.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, bookingFeed } = require('./datesTakenFixture');

const conflictEmail = (id, origin = 'ical') => {
  const service = require('../utils/notificationService');
  const resa = db.prepare('SELECT r.*, p.name AS propertyName FROM reservations r JOIN properties p ON p.id = r.propertyId WHERE r.id = ?').get(id);
  return service.__test.buildConflictEmail(resa, 'https://gf.example.test', origin);
};

test('rule 39: an iCal booking on nights an acompte holds is recorded, flagged and called an over-booking', async () => {
  const propertyId = freshProperty();
  const held = addStay({ propertyId, start: inDays(40), end: inDays(44), depositPaid: 1 });
  const result = await bookingFeed(propertyId).sync([{ uid: 'h1@booking', start: inDays(42), end: inDays(45) }]);
  const [created] = result.createdReservationIds;
  assert.ok(created, 'the platform booking is recorded');
  assert.ok(db.prepare('SELECT bookingConflictAt FROM reservations WHERE id = ?').get(created).bookingConflictAt);
  const { subject, text } = conflictEmail(created);
  assert.match(subject, /Surbooking : Booking sur des dates réservées/);
  assert.match(text, new RegExp(`Dates réservées par l’acompte de T${held}`));
  assert.match(text, /Annuler l’une des deux réservations\./);
  assert.match(text, new RegExp(`/reservations/${held}`));
});

test('rule 39: another platform stay holds its nights too; an unpaid direct stay keeps the plain conflict wording', async () => {
  const propertyId = freshProperty();
  addStay({ propertyId, platform: 'Airbnb', start: inDays(50), end: inDays(53) });
  const onPlatform = (await bookingFeed(propertyId).sync([{ uid: 'h2@booking', start: inDays(51), end: inDays(52) }])).createdReservationIds[0];
  assert.match(conflictEmail(onPlatform).text, /Dates réservées par la réservation Airbnb/);

  const other = freshProperty();
  addStay({ propertyId: other, start: inDays(60), end: inDays(63) });
  const onUnpaid = (await bookingFeed(other).sync([{ uid: 'h3@booking', start: inDays(61), end: inDays(62) }])).createdReservationIds[0];
  const plain = conflictEmail(onUnpaid);
  assert.doesNotMatch(plain.subject, /Surbooking/);
  assert.match(plain.subject, /Conflit de dates — flux/);
});

test('rule 38: a payment-origin conflict keeps its own wording', () => {
  const propertyId = freshProperty();
  addStay({ propertyId, platform: 'Booking', start: inDays(70), end: inDays(73) });
  const paid = addStay({ propertyId, start: inDays(71), end: inDays(72), depositPaid: 1 });
  assert.match(conflictEmail(paid, 'payment').subject, /Conflit de dates — paiement en ligne/);
});

test('rule 39: the pending drift onto held nights carries the warning and the stays; elsewhere none', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, platform: 'Booking', start: inDays(80), end: inDays(83), extra: { icalSyncLocked: 1 } });
  const held = addStay({ propertyId, start: inDays(85), end: inDays(88), depositPaid: 1 });
  const drift = require('../models/icalDateDriftModel').buildModel(db);
  drift.recordPending({ reservationId: stay, previousStartDate: inDays(80), previousEndDate: inDays(83), newStartDate: inDays(84), newEndDate: inDays(86) });
  const row = drift.listPending().find((a) => a.reservationId === stay);
  assert.equal(row.heldDates.title, 'Surbooking : Booking sur des dates réservées');
  assert.deepEqual(row.heldDates.stays.map((s) => s.id), [held]);
  assert.equal(row.heldDates.stays[0].url, `/reservations/${held}`);
  const free = addStay({ propertyId, platform: 'Booking', start: inDays(100), end: inDays(103), extra: { icalSyncLocked: 1 } });
  drift.recordPending({ reservationId: free, previousStartDate: inDays(100), previousEndDate: inDays(103), newStartDate: inDays(101), newEndDate: inDays(104) });
  assert.equal(drift.listPending().find((a) => a.reservationId === free).heldDates, null);
});
