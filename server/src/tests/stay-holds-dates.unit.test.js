// specs/payment-link-lifecycle.md rule 37 (§9 Q9) — a stay holds its dates when it is a reservation that carries
// money (rule 31: an acompte paid is enough, the solde open or not) or comes from a platform. A devis never holds
// them, an unpaid direct reservation neither, and a cancellation frees them. Rule 10 (§9 Q11): two unpaid rows on the
// same nights both keep their links; the first paid withdraws the other's.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf } = require('./datesTakenFixture');
const { holdsDates, carriesMoney } = require('../utils/stayMoney');
const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');

const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

test('rule 37: an acompte paid holds the dates, the solde still open', () => {
  const p = freshProperty();
  const id = addStay({ propertyId: p, start: inDays(30), end: inDays(33), depositPaid: 1 });
  assert.equal(carriesMoney(db, id), true);
  assert.equal(holdsDates(db, row(id)), true);
});

test('rule 37: a platform stay holds its dates without any money recorded here', () => {
  const p = freshProperty();
  assert.equal(holdsDates(db, row(addStay({ propertyId: p, platform: 'Booking', start: inDays(30), end: inDays(33) }))), true);
});

test('rule 37: an own channel counted as direct does not hold its dates unpaid', () => {
  const { setDirectChannels } = require('../utils/platformNameFormat');
  setDirectChannels(['Site internet']);
  try {
    const p = freshProperty();
    assert.equal(holdsDates(db, row(addStay({ propertyId: p, platform: 'Site internet', start: inDays(30), end: inDays(33) }))), false);
  } finally { setDirectChannels([]); }
});

test('rule 37: an unpaid direct reservation, a devis and a cancelled stay hold nothing', () => {
  const p = freshProperty();
  assert.equal(holdsDates(db, row(addStay({ propertyId: p, start: inDays(40), end: inDays(42) }))), false);
  const devisId = addStay({ propertyId: p, kind: 'devis', start: inDays(40), end: inDays(42) });
  addLink(devisId, { status: 'paid' });
  assert.equal(holdsDates(db, row(devisId)), false, 'a devis never holds, even with a paid link');
  assert.equal(holdsDates(db, row(addStay({ propertyId: p, kind: 'cancelled', platform: 'Booking', start: inDays(40), end: inDays(42), depositPaid: 1 }))), false);
});

test('rule 31: a paid installment and a payment carried by a withdrawn link are money', () => {
  const p = freshProperty();
  const a = addStay({ propertyId: p, start: inDays(50), end: inDays(52) });
  db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid) VALUES (?, 1, ?, 1000, 1)').run(a, inDays(10));
  const b = addStay({ propertyId: p, start: inDays(60), end: inDays(62) });
  const link = addLink(b, { status: 'cancelled' });
  db.prepare('UPDATE payment_links SET paidAt = ? WHERE id = ?').run(new Date().toISOString(), link);
  assert.equal(carriesMoney(db, a), true);
  assert.equal(carriesMoney(db, b), true);
});

test('rule 10 (Q11): the first paid of two unpaid reservations withdraws the other one link', () => {
  const p = freshProperty();
  const first = addStay({ propertyId: p, start: inDays(70), end: inDays(73) });
  const second = addStay({ propertyId: p, start: inDays(71), end: inDays(74) });
  const mine = addLink(first, { type: 'balance' });
  const theirs = addLink(second);
  recordStayPayment(depsFor(db), { reservationId: first, bucket: 'deposit', keepPaymentOnCaptureFailure: true });
  assert.equal(linkOf(mine).status, 'open', 'the paid stay keeps its solde link');
  assert.equal(linkOf(theirs).cancelReason, 'dates-taken');
});
