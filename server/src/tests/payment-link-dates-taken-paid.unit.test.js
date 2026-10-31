// specs/payment-link-lifecycle.md rule 33 (§9 Q5) — a link withdrawn because its dates were taken, found paid by
// the read that precedes its deactivation (payment in flight, webhook lost): the money is the stay's. The link goes
// `cancelled → paid`, a devis is converted with `allowConflict` and a reservation records its bucket, the stay is
// stamped `bookingConflictAt`, no confirmation leaves, and the admin is told « déplacer le séjour ou le rembourser ».

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf } = require('./datesTakenFixture');
const { withdrawLinksOverlapping } = require('../utils/paymentLinkLifecycle');
const { retryPendingCancellations } = require('../utils/paymentPollRunner');
const { conflictCheckerFor } = require('../utils/paymentEffectDeps');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');

function paidProvider() {
  const calls = [];
  return {
    calls, id: 'qonto', label: 'Qonto', isReady: () => true,
    getPayment: async (linkId) => { calls.push(['getPayment', linkId]); return { paid: true, paymentId: `pay_${linkId}`, paidAt: new Date().toISOString() }; },
    getLinkStatus: async () => 'open',
    cancelLink: async (linkId) => { calls.push(['cancelLink', linkId]); },
  };
}

async function retry(link, provider) {
  const notified = [];
  const conflicts = [];
  const confirmed = [];
  const out = await retryPendingCancellations({
    only: link, paymentLinksModel, provider, database: db, devisModel,
    checkConflict: conflictCheckerFor(db), logger: { log() {}, warn() {} },
    notifyPaidAfterCancel: async (l, o) => { notified.push(o); },
    notifyConflict: async (id) => { conflicts.push(id); },
    sendConfirmation: async (id) => { confirmed.push(id); },
    emitPluginEvent: () => {},
  });
  return { out, notified, conflicts, confirmed };
}

test('rule 33: a devis link paid in flight converts the devis in date conflict, without a confirmation, and alerts', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(40), end: inDays(44) });
  const link = addLink(devisId);
  const holder = addStay({ propertyId, platform: 'Booking', start: inDays(41), end: inDays(43) });
  withdrawLinksOverlapping(db, { propertyId, startDate: inDays(41), endDate: inDays(43), causeId: holder });
  assert.equal(linkOf(link).cancelReason, 'dates-taken');

  const provider = paidProvider();
  const { out, notified, conflicts, confirmed } = await retry(link, provider);
  assert.equal(out.results[0].status, 'paid');
  assert.deepEqual(provider.calls.map((c) => c[0]), ['getPayment'], 'read first; a paid link is not deactivated');
  assert.equal(linkOf(link).status, 'paid');
  const converted = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(devisId).convertedReservationId;
  assert.ok(converted, 'the devis became a reservation');
  const stay = db.prepare('SELECT depositPaid, bookingConflictAt FROM reservations WHERE id = ?').get(converted);
  assert.equal(stay.depositPaid, 1);
  assert.ok(stay.bookingConflictAt);
  assert.deepEqual(confirmed, [], 'no confirmation e-mail');
  assert.deepEqual(conflicts, [converted]);
  const alert = notified.find((o) => o && o.datesTaken);
  assert.ok(alert, JSON.stringify(notified));
  assert.equal(alert.nightsUnavailable, 'taken');
  assert.match(alert.takenBy, new RegExp(`T${holder}`));
});

test('rule 33: a reservation link paid in flight records its bucket, stamps the conflict and alerts', async () => {
  const propertyId = freshProperty();
  const stayId = addStay({ propertyId, start: inDays(60), end: inDays(63) });
  const link = addLink(stayId, { type: 'full', amountCents: 40000 });
  addStay({ propertyId, platform: 'Airbnb', start: inDays(61), end: inDays(62) });
  withdrawLinksOverlapping(db, { now: new Date() });
  const { notified, conflicts, confirmed } = await retry(link, paidProvider());
  const row = db.prepare('SELECT depositPaid, balancePaid, bookingConflictAt FROM reservations WHERE id = ?').get(stayId);
  assert.equal(row.balancePaid, 1);
  assert.ok(row.bookingConflictAt);
  assert.deepEqual(confirmed, []);
  assert.deepEqual(conflicts, [stayId]);
  assert.ok(notified.some((o) => o && o.datesTaken));
});

test('rule 33: the alert e-mail says what happened and what to do', () => {
  const service = require('../utils/notificationService');
  const { subject, text } = service.__test.buildPaidAfterCancelEmail(
    { id: 9, kind: 'reservation', propertyName: 'Logement', startDate: inDays(10), endDate: inDays(12) },
    { id: 3, amountCents: 12000 }, '', { nightsUnavailable: 'taken', datesTaken: true, takenBy: 'T77 · Lina Exemple' },
  );
  assert.match(subject, /Paiement reçu sur des dates déjà prises/);
  assert.match(text, /Action requise : déplacer le séjour ou le rembourser\./);
  assert.match(text, /Dates prises par : T77 · Lina Exemple/);
  assert.match(text, /Aucun e-mail de confirmation/);
});

test('rule 14: an unpaid dates-taken link is simply deactivated after its read', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(80), end: inDays(83) });
  const link = addLink(devisId);
  addStay({ propertyId, platform: 'Booking', start: inDays(81), end: inDays(82) });
  withdrawLinksOverlapping(db, { now: new Date() });
  const calls = [];
  const unpaid = { id: 'qonto', isReady: () => true, getLinkStatus: async () => 'open',
    getPayment: async () => { calls.push('getPayment'); return { paid: false }; },
    cancelLink: async () => { calls.push('cancelLink'); } };
  await retryPendingCancellations({ only: link, paymentLinksModel, provider: unpaid, database: db, devisModel, logger: { log() {} } });
  assert.deepEqual(calls, ['getPayment', 'cancelLink']);
  const row = linkOf(link);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.remoteCancelPendingAt, null);
});
