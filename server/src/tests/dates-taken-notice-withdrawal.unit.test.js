// specs/payment-link-lifecycle.md rules 43, 44 and 64 (review of #912) — the guest notice answers ONE withdrawal: the
// stay that took the nights then, read unpaid after the deactivation (rule 19's last look), judged once. Freed nights
// booked again by another stay, a link that lapsed, a devis moved to other dates, a devis already told then converted,
// a payment still in flight, a deactivation found done without a read, a platform stay, a stay taken by its own
// guest: nobody is mailed. A send whose acceptance was not recorded stays « envoi incertain », never resent.
// Made-up stays; nothing leaves the process.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf, bookingFeed, providerReads } = require('./datesTakenFixture');
const paymentLinksModel = require('../models/paymentLinksModel');
const realLogModel = require('../models/emailLogModel');
const { buildDatesTakenNotice, datesTakenCard } = require('../utils/datesTakenNotice');
const { withdrawLinksOverlapping } = require('../utils/paymentLinkLifecycle');
const { fakeProvider } = require('./paymentLinkLifecycleFixture');

const settingsModel = { read: () => ({ companyName: 'Demo' }), decryptedSmtpSettings: () => ({}) };

function harness({ logModel = null, autoSendExceptions } = {}) {
  const mails = [];
  const pushes = [];
  const notice = buildDatesTakenNotice({
    database: db, settingsModel, push: async (p) => { pushes.push(p); }, logger: { log: () => {}, warn: () => {} },
    emailServiceFactory: () => ({ isConfigured: true, send: async (m) => { mails.push(m); } }),
    ...(logModel ? { logModel } : {}),
    ...(autoSendExceptions ? { autoSendExceptions } : {}),
  });
  return { notice, mails, pushes };
}

const noticeRow = (stayId) => db.prepare('SELECT * FROM dates_taken_notices WHERE reservationId = ?').get(stayId);
const unpaidRead = (linkId) => providerReads(linkId, fakeProvider());

let clientSeq = 0;
function newClient(first = 'Lina') {
  clientSeq += 1;
  return Number(db.prepare('INSERT INTO clients (firstName, lastName, email) VALUES (?, ?, ?)').run(first, `Exemple${clientSeq}`, `guest${clientSeq}@example.test`).lastInsertRowid);
}

// A direct devis of its own client, with a link, then a Booking stay (another client) on its nights: withdrawn.
function devisTaken({ start, platform = 'direct', kind = 'devis' } = {}) {
  const propertyId = freshProperty();
  const stayId = addStay({ propertyId, kind, platform, start: inDays(start), end: inDays(start + 4), extra: { clientId: newClient() } });
  const linkId = addLink(stayId);
  const takerId = addStay({ propertyId, platform: 'Booking', start: inDays(start + 1), end: inDays(start + 3), extra: { clientId: newClient('Taker') } });
  withdrawLinksOverlapping(db, { now: new Date() });
  return { propertyId, stayId, linkId, takerId };
}

test('rule 64 — the withdrawal records the stay that took the nights', () => {
  const s = devisTaken({ start: 400 });
  assert.equal(linkOf(s.linkId).cancelReason, 'dates-taken');
  assert.equal(linkOf(s.linkId).takenByReservationId, s.takerId);
});

test('rule 64 (B1) — nights freed, then booked by an unrelated stay: nothing is sent, the withdrawal closed for good', async () => {
  const h = harness();
  const s = devisTaken({ start: 410 });
  await unpaidRead(s.linkId);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(s.takerId);
  await h.notice.runDueNotices();
  assert.ok(linkOf(s.linkId).noticeJudgedAt, 'judged « dates free » once');
  addStay({ propertyId: s.propertyId, platform: 'Booking', start: inDays(411), end: inDays(413), extra: { clientId: newClient('Other') } });
  await h.notice.runDueNotices();
  assert.equal((await h.notice.notifyDatesTaken(s.stayId)).status, 'not-due');
  assert.equal(h.mails.length, 0);
  assert.equal(h.pushes.length, 0);
  assert.equal(noticeRow(s.stayId), undefined);
});

test('rule 64 (B1) — the taker gone and another stay on the nights before the read: nothing is sent', async () => {
  const h = harness();
  const s = devisTaken({ start: 420 });
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(s.takerId);
  addStay({ propertyId: s.propertyId, platform: 'Booking', start: inDays(421), end: inDays(423), extra: { clientId: newClient('Other') } });
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.ok(linkOf(s.linkId).noticeJudgedAt);
});

test('rule 64 (B1) — a later link that lapsed by validity never sends a « dates prises » notice', async () => {
  const h = harness();
  const s = devisTaken({ start: 430 });
  await unpaidRead(s.linkId);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(s.takerId);
  await h.notice.runDueNotices();
  const fresh = addLink(s.stayId);
  db.prepare("UPDATE payment_links SET status = 'expired', cancelReason = 'validity', remoteCancelPendingAt = NULL WHERE id = ?").run(fresh);
  addStay({ propertyId: s.propertyId, platform: 'Booking', start: inDays(431), end: inDays(433), extra: { clientId: newClient('Other') } });
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(noticeRow(s.stayId), undefined);
});

test('rule 64 (B1) — a devis moved to other dates, held by another stay, is not told about its old link', async () => {
  const h = harness();
  const s = devisTaken({ start: 440 });
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(inDays(460), inDays(463), s.stayId);
  addStay({ propertyId: s.propertyId, platform: 'Booking', start: inDays(460), end: inDays(463), extra: { clientId: newClient('Other') } });
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(noticeRow(s.stayId), undefined);
});

test('rule 64 (B1) — a devis told once, then converted, is never told again for the reservation it became', async () => {
  const h = harness();
  const s = devisTaken({ start: 470 });
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1, 'the devis is told');
  const client = db.prepare('SELECT clientId FROM reservations WHERE id = ?').get(s.stayId).clientId;
  const reservationId = addStay({ propertyId: s.propertyId, start: inDays(470), end: inDays(474), extra: { clientId: client } });
  db.prepare("UPDATE reservations SET convertedReservationId = ?, devisStatus = 'accepted' WHERE id = ?").run(reservationId, s.stayId);
  const second = addLink(reservationId);
  withdrawLinksOverlapping(db, { now: new Date() });
  assert.equal(linkOf(second).cancelReason, 'dates-taken');
  await unpaidRead(second);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1, 'once, keyed on the devis and the reservation');
  assert.equal(noticeRow(reservationId), undefined);
  assert.ok(linkOf(second).noticeJudgedAt);
});

test('rule 64 (M1) — no notice before the read made after the deactivation, nor while a payment is in flight', async () => {
  const h = harness();
  const s = devisTaken({ start: 480 });
  const inFlight = fakeProvider({ pending: (id, origin) => origin === 'last-look' });
  await providerReads(s.linkId, inFlight, { lastLook: false });
  assert.equal(linkOf(s.linkId).remoteCancelPendingAt, null, 'deactivated');
  assert.ok(linkOf(s.linkId).lastLookAt, 'a read is owed after the deactivation');
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  await providerReads(s.linkId, inFlight);
  assert.ok(linkOf(s.linkId).lastLookAt, 'a payment in flight: the read stays owed');
  assert.equal(linkOf(s.linkId).unpaidReadAt, null);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1, 'read unpaid at last: told once');
});

test('rule 64 (M1) — paid by the time of the last look: rule 33 books it, no notice', async () => {
  const h = harness();
  const s = devisTaken({ start: 490 });
  await providerReads(s.linkId, fakeProvider({ paid: (id, origin) => origin === 'last-look' }));
  assert.equal(linkOf(s.linkId).status, 'paid');
  assert.equal(linkOf(s.linkId).lastLookAt, null);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(noticeRow(s.stayId), undefined);
});

test('rule 64 (M1) — a deactivation found already done without a payment read keeps the read owed', async () => {
  const h = harness();
  const s = devisTaken({ start: 500 });
  const unreadable = fakeProvider({ failPayment: new Error('timeout'), linkStatus: 'cancelled' });
  await providerReads(s.linkId, unreadable, { lastLook: false });
  assert.equal(linkOf(s.linkId).remoteCancelPendingAt, null, 'already inactive at the provider');
  assert.ok(linkOf(s.linkId).lastLookAt, 'no read yet: one is owed');
  await providerReads(s.linkId, unreadable);
  assert.ok(linkOf(s.linkId).lastLookAt, 'the read failed: still owed');
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1);
});

test('rule 64 (M2) — a platform stay is never told « vos dates ne sont plus disponibles »', async () => {
  const h = harness();
  const s = devisTaken({ start: 510, kind: 'reservation', platform: 'Airbnb' });
  assert.equal(linkOf(s.linkId).cancelReason, 'dates-taken');
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(noticeRow(s.stayId), undefined);
  assert.ok(linkOf(s.linkId).noticeJudgedAt);
});

test('rule 64 (M2) — nights taken by a stay of the same client: the guest is not told', async () => {
  const h = harness();
  const s = devisTaken({ start: 520 });
  const client = db.prepare('SELECT clientId FROM reservations WHERE id = ?').get(s.stayId).clientId;
  db.prepare('UPDATE reservations SET clientId = ? WHERE id = ?').run(client, s.takerId);
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(noticeRow(s.stayId), undefined);
});

test('rule 64 (m1) — claimed `sending`, `sent` with its history row; an unrecorded acceptance stays « envoi incertain », never resent', async () => {
  const ok = harness();
  const told = devisTaken({ start: 530 });
  await unpaidRead(told.linkId);
  await ok.notice.runDueNotices();
  const row = noticeRow(told.stayId);
  assert.equal(row.noticeStatus, 'sent');
  assert.ok(row.emailLogId);

  const brokenLog = { ...realLogModel, insert: (payload) => { if (payload.status === 'sent') throw new Error('disk I/O error'); return realLogModel.insert(payload); } };
  const h = harness({ logModel: brokenLog });
  const s = devisTaken({ start: 540 });
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1, 'SMTP accepted it');
  assert.equal(noticeRow(s.stayId).noticeStatus, 'sending');
  assert.match(h.pushes[0].body, /, envoi incertain\.$/);
  const card = datesTakenCard(db).find((a) => a.reservationId === s.stayId);
  assert.deepEqual(card.notice, { sent: false, label: 'envoi incertain' });
  assert.equal(card.detail, 'Envoi interrompu : vérifier l’historique des e-mails.');
  await h.notice.runDueNotices();
  assert.equal((await h.notice.notifyDatesTaken(s.stayId)).status, 'not-due');
  assert.equal(h.mails.length, 1, 'never resent');
});

test('rule 44 (n3) — without the key in AUTO_SEND_EXCEPTIONS nothing leaves; the row says why', async () => {
  const h = harness({ autoSendExceptions: [] });
  const s = devisTaken({ start: 550 });
  await unpaidRead(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(noticeRow(s.stayId).noticeStatus, 'not-sent');
  assert.equal(noticeRow(s.stayId).noticeReason, 'not-allowed');
  assert.match(h.pushes[0].body, /client non prévenu : envoi automatique non autorisé\.$/);
});

test('rule 64 (m3) — a judged withdrawal is no candidate any more: the pass reads nothing for it', async () => {
  const h = harness();
  const s = devisTaken({ start: 560 });
  await unpaidRead(s.linkId);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(s.takerId);
  const first = await h.notice.runDueNotices();
  assert.ok(first.some((r) => r.stayId === s.stayId && r.status === 'closed' && r.reason === 'dates-free'));
  const second = await h.notice.runDueNotices();
  assert.ok(!second.some((r) => r.stayId === s.stayId));
});

test('rule 64 — the iCal path still tells the guest once (happy path)', async () => {
  const h = harness();
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(570), end: inDays(574), extra: { clientId: newClient() } });
  const linkId = addLink(devisId);
  await bookingFeed(propertyId).sync([{ uid: `w${devisId}@booking`, start: inDays(571), end: inDays(573) }]);
  assert.ok(linkOf(linkId).takenByReservationId);
  await unpaidRead(linkId);
  await h.notice.runDueNotices();
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1);
  assert.equal(noticeRow(devisId).noticeStatus, 'sent');
  assert.equal(paymentLinksModel.findById(linkId).status, 'cancelled');
});

test('rule 64 (M1) — the Qonto adapter reports a payment neither paid nor failed as in flight (an unknown status too)', { skip: require('../plugins/sdk/testing').skipWithout(['online-payment']) }, () => {
  const { hasPaymentInFlight } = require('../plugins/online-payment/provider');
  assert.equal(hasPaymentInFlight([]), false);
  assert.equal(hasPaymentInFlight([{ status: 'failed' }, { status: 'canceled' }, { status: 'expired' }]), false);
  assert.equal(hasPaymentInFlight([{ status: 'failed' }, { status: 'processing' }]), true);
  assert.equal(hasPaymentInFlight([{ status: 'pending' }]), true);
  assert.equal(hasPaymentInFlight([{ status: 'something_new' }]), true, 'fails closed');
});
