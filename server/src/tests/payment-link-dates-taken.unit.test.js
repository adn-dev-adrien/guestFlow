// specs/payment-link-lifecycle.md rules 10, 11, 31, 32 — an unpaid devis or reservation whose nights a stay holding
// its dates now covers loses its open links (`dates-taken`, deactivation owed), and no link is minted on it again
// (409 DATES_UNAVAILABLE). Every way such a stay can appear withdraws: iCal import or re-date, conversion of the
// other devis by its payment, an acompte recorded, a manual creation or save, « Rétablir », an approved iCal drift.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf, bookingFeed } = require('./datesTakenFixture');
const { ensurePaymentLink, sendPaymentRequest } = require('../utils/paymentRequestService');
const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');
const { withdrawLinksOverlapping } = require('../utils/paymentLinkLifecycle');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');

const withdrawnForDatesTaken = (id) => {
  const link = linkOf(id);
  return link.status === 'cancelled' && link.cancelReason === 'dates-taken' && Boolean(link.remoteCancelPendingAt);
};
const stillOpen = (id) => linkOf(id).status === 'open';

test('rule 10 (case a): a Booking stay imported on the nights of a direct devis withdraws the devis link', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(40), end: inDays(44) });
  const link = addLink(devisId);
  const feed = bookingFeed(propertyId);
  await feed.sync([{ uid: 'a1@booking', start: inDays(42), end: inDays(45) }]);
  assert.ok(withdrawnForDatesTaken(link), JSON.stringify(linkOf(link)));
  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND changedFields LIKE '%dates prises%'").get(devisId);
  assert.ok(history, 'the devis history names the withdrawal');
});

test('rule 10: an unpaid direct reservation overlapped by an iCal import loses its link too', async () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: inDays(50), end: inDays(53) });
  const link = addLink(stay, { type: 'full' });
  await bookingFeed(propertyId).sync([{ uid: 'a2@booking', start: inDays(51), end: inDays(52) }]);
  assert.ok(withdrawnForDatesTaken(link));
});

test('rule 32: an iCal stay the feed moves onto the nights withdraws them; elsewhere nothing moves', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(70), end: inDays(73) });
  const link = addLink(devisId);
  const feed = bookingFeed(propertyId);
  await feed.sync([{ uid: 'a3@booking', start: inDays(80), end: inDays(83) }]);
  assert.ok(stillOpen(link), 'another week: the devis keeps its link');
  await feed.sync([{ uid: 'a3@booking', start: inDays(72), end: inDays(75) }]);
  assert.ok(withdrawnForDatesTaken(link), 're-dated onto the devis nights');
});

test('rule 10: a neighbour leaving on the arrival day frees the night; a late check-out takes it', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(90), end: inDays(93) });
  const link = addLink(devisId);
  addStay({ propertyId, platform: 'Booking', start: inDays(87), end: inDays(90) });
  withdrawLinksOverlapping(db, { propertyId, startDate: inDays(87), endDate: inDays(90) });
  assert.ok(stillOpen(link), 'a departure on the arrival day overlaps no night');
  addStay({ propertyId, platform: 'Airbnb', start: inDays(85), end: inDays(90), checkOutTime: '18:00' });
  withdrawLinksOverlapping(db, { propertyId, startDate: inDays(85), endDate: inDays(90) });
  assert.ok(withdrawnForDatesTaken(link), 'a late check-out blocks the arrival night, as the public pay reads it');
});

test('rule 31: a reservation with its acompte paid keeps its solde link, its dates being held', async () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: inDays(100), end: inDays(104), depositPaid: 1 });
  const link = addLink(stay, { type: 'balance' });
  await bookingFeed(propertyId).sync([{ uid: 'a4@booking', start: inDays(101), end: inDays(103) }]);
  assert.ok(stillOpen(link));
});

test('rule 31: money on the devis a reservation came from counts too; a cash payment counts', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: inDays(110), end: inDays(113) });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(110), end: inDays(113), convertedReservationId: stay });
  db.prepare("UPDATE reservations SET devisStatus = 'converted' WHERE id = ?").run(devisId);
  addLink(devisId, { status: 'paid' });
  const open = addLink(stay, { type: 'balance' });
  const cash = addStay({ propertyId, start: inDays(120), end: inDays(123), extra: { balancePaidCash: 1 } });
  const cashLink = addLink(cash, { type: 'complement' });
  addStay({ propertyId, platform: 'Booking', start: inDays(111), end: inDays(112) });
  addStay({ propertyId, platform: 'Booking', start: inDays(121), end: inDays(122) });
  withdrawLinksOverlapping(db, { now: new Date() });
  assert.ok(stillOpen(open), 'the stay its devis paid is not unpaid');
  assert.ok(stillOpen(cashLink), 'a solde paid in cash is money');
});

test('rule 10: the row itself and the stay its devis became never take its nights', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, platform: 'Booking', start: inDays(130), end: inDays(133) });
  const own = addLink(stay, { type: 'full' });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(140), end: inDays(143) });
  const converted = addStay({ propertyId, platform: 'Booking', start: inDays(140), end: inDays(143) });
  db.prepare("UPDATE reservations SET convertedReservationId = ?, devisStatus = 'converted' WHERE id = ?").run(converted, devisId);
  const devisLink = addLink(devisId);
  withdrawLinksOverlapping(db, { now: new Date() });
  assert.ok(stillOpen(own), 'a platform stay does not take its own nights');
  assert.ok(stillOpen(devisLink), 'nor does the stay a devis became take the devis link');
});

test('rule 10 (case b): the first of two devis paid converts, holds the nights and withdraws the other link', () => {
  const propertyId = freshProperty();
  const first = addStay({ propertyId, kind: 'devis', start: inDays(150), end: inDays(154) });
  const second = addStay({ propertyId, kind: 'devis', start: inDays(152), end: inDays(156) });
  const paid = addLink(first);
  const other = addLink(second);
  paymentLinksModel.markPaid(paid, { providerPaymentId: 'pay_1', paidAt: new Date().toISOString() });
  const conv = devisModel.convertToReservation(first, { allowConflict: true });
  assert.equal(conv.ok, true);
  assert.ok(withdrawnForDatesTaken(other));
  assert.equal(linkOf(other).cancelReason, 'dates-taken');
});

test('rule 37: a « Convertir » with no money takes nothing: an unpaid direct reservation withdraws no one', () => {
  const propertyId = freshProperty();
  const first = addStay({ propertyId, kind: 'devis', start: inDays(160), end: inDays(163) });
  const second = addStay({ propertyId, kind: 'devis', start: inDays(161), end: inDays(164) });
  const other = addLink(second);
  assert.equal(devisModel.convertToReservation(first, { allowConflict: true }).ok, true);
  assert.ok(stillOpen(other));
});

test('rule 32: an acompte recorded on a reservation (first paid wins) withdraws the devis link on its nights', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: inDays(170), end: inDays(173) });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(171), end: inDays(174) });
  const link = addLink(devisId);
  recordStayPayment(depsFor(db), { reservationId: stay, bucket: 'deposit', keepPaymentOnCaptureFailure: true, origin: 'fiche' });
  assert.ok(withdrawnForDatesTaken(link));
});

test('rule 32: « Rétablir » a platform stay set aside withdraws the link on its nights', async () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, kind: 'superseded', platform: 'Booking', start: inDays(180), end: inDays(183) });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(181), end: inDays(183) });
  const link = addLink(devisId);
  const controller = require('../controllers/reservationsController');
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.restoreSuperseded({ params: { id: String(stay) }, user: { email: 'admin@example.test' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(withdrawnForDatesTaken(link));
});

test('rule 32: an approved iCal drift onto the nights withdraws the link there', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, platform: 'Booking', start: inDays(190), end: inDays(193), extra: { icalSyncLocked: 1 } });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(195), end: inDays(198) });
  const link = addLink(devisId);
  const drift = require('../models/icalDateDriftModel').buildModel(db);
  const { id } = drift.recordPending({ reservationId: stay, previousStartDate: inDays(190), previousEndDate: inDays(193), newStartDate: inDays(194), newEndDate: inDays(197) });
  assert.equal(drift.approve(id).ok, true);
  assert.ok(withdrawnForDatesTaken(link));
});

test('rule 32: a manual creation and a save of a platform stay withdraw; an unpaid direct one does not', async () => {
  const propertyId = freshProperty();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (?, 'Standard', 100)").run(propertyId);
  const controller = require('../controllers/reservationsController');
  const body = (start, end, platform) => ({
    propertyId, clientId: 1, startDate: start, endDate: end, checkInTime: '16:00', checkOutTime: '10:00', platform,
    adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [],
  });
  const create = (b) => new Promise((resolve) => {
    controller.create({ body: b, user: { role: 'admin' } }, { status() { return this; }, json: resolve });
  });
  const devisA = addStay({ propertyId, kind: 'devis', start: inDays(200), end: inDays(203) });
  const linkA = addLink(devisA);
  await create(body(inDays(200), inDays(202), 'direct'));
  assert.ok(stillOpen(linkA), 'an unpaid direct reservation blocks the calendar but takes no link');
  const devisB = addStay({ propertyId, kind: 'devis', start: inDays(210), end: inDays(213) });
  const linkB = addLink(devisB);
  const created = await create(body(inDays(210), inDays(212), 'Booking'));
  assert.ok(created.id, JSON.stringify(created));
  assert.ok(withdrawnForDatesTaken(linkB), 'a platform stay created by hand holds its nights');
  const devisC = addStay({ propertyId, kind: 'devis', start: inDays(220), end: inDays(223) });
  const linkC = addLink(devisC);
  const moved = controller.performUpdate(created.id, body(inDays(220), inDays(222), 'Booking'));
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.ok(withdrawnForDatesTaken(linkC), 'its date change onto other nights withdraws there');
  const devisD = addStay({ propertyId, kind: 'devis', start: inDays(230), end: inDays(233) });
  const linkD = addLink(devisD);
  controller.performUpdate(created.id, body(inDays(230), inDays(232), 'Booking'), { dryRun: true });
  assert.ok(stillOpen(linkD), 'a dry run withdraws nothing');
});

test('rule 10 (Q11): two unpaid rows on the same nights both keep their links', () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(240), end: inDays(243) });
  const stay = addStay({ propertyId, start: inDays(240), end: inDays(243) });
  const a = addLink(devisId);
  const b = addLink(stay);
  withdrawLinksOverlapping(db, { now: new Date() });
  assert.ok(stillOpen(a) && stillOpen(b));
});

const provider = () => {
  const calls = [];
  return {
    calls, id: 'qonto', label: 'Qonto', isReady: () => true,
    createLink: async () => { calls.push('createLink'); return { id: 'pl_x', url: 'https://pay.example.test/x', status: 'open' }; },
    getPayment: async () => { calls.push('getPayment'); return { paid: false }; },
    getLinkStatus: async () => 'open',
    cancelLink: async () => { calls.push('cancelLink'); },
  };
};

test('rule 11: no link is minted on an unpaid row whose nights are held, before any provider call', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(250), end: inDays(253) });
  addStay({ propertyId, platform: 'Booking', start: inDays(251), end: inDays(252) });
  const p = provider();
  const deps = { database: db, paymentLinksModel, provider: p, resolveAmountCents: () => 12000 };
  await assert.rejects(ensurePaymentLink(deps, devisId, 'deposit'), (err) => err.httpStatus === 409 && err.error === 'DATES_UNAVAILABLE'
    && err.message === 'Dates déjà prises par une autre réservation : aucun lien créé.');
  assert.deepEqual(p.calls, []);
});

test('rule 11: an overlap with another unpaid row refuses nothing; a row carrying money is never refused', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(260), end: inDays(263) });
  addStay({ propertyId, start: inDays(260), end: inDays(263) });
  const deps = { database: db, paymentLinksModel, provider: provider(), resolveAmountCents: () => 12000 };
  assert.equal((await ensurePaymentLink(deps, devisId, 'deposit')).reused, false);
  const paidStay = addStay({ propertyId, start: inDays(270), end: inDays(274), depositPaid: 1 });
  addStay({ propertyId, platform: 'Booking', start: inDays(271), end: inDays(272) });
  assert.equal((await ensurePaymentLink(deps, paidStay, 'balance')).reused, false);
});

test('rule 25: « Demander le paiement » after its link lapsed mints anew; on taken dates the request is refused, nothing sent', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(280), end: inDays(284) });
  db.prepare("UPDATE payment_links SET status = 'expired' WHERE id = ?").run(addLink(devisId, { type: 'deposit' }));
  const sent = [];
  const deps = { database: db, paymentLinksModel, provider: provider(), resolveAmountCents: () => 12000, sendTemplate: async (m) => { sent.push(m); return { sent: true }; } };
  assert.equal((await sendPaymentRequest(deps, devisId, 'deposit')).httpStatus, 200);
  addStay({ propertyId, platform: 'Booking', start: inDays(281), end: inDays(283) });
  await assert.rejects(sendPaymentRequest(deps, devisId, 'deposit'), (err) => err.httpStatus === 409 && err.error === 'DATES_UNAVAILABLE');
  assert.equal(sent.length, 1, 'the refused request sends nothing');
});
