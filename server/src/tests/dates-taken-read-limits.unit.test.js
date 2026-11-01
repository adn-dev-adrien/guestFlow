// specs/payment-link-lifecycle.md rules 52, 64 (re-review of #912) — the read a `dates-taken` link owes after its
// deactivation has limits: a payment still in flight 24 h after the withdrawal stops the re-reads, closes the link
// without a notice and alerts the operator once; a link withdrawn while it was being minted (never sent) never holds
// the stay's real withdrawal back; a link withdrawn before the taker was recorded is closed once; a history row that
// cannot be written after SMTP acceptance keeps the previous `failed` trace for every other template. Made-up stays.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf, providerReads } = require('./datesTakenFixture');
const paymentLinksModel = require('../models/paymentLinksModel');
const realLogModel = require('../models/emailLogModel');
const templatesModel = require('../models/emailTemplatesModel');
const { buildDatesTakenNotice } = require('../utils/datesTakenNotice');
const { withdrawLinksOverlapping } = require('../utils/paymentLinkLifecycle');
const { runLastLooks } = require('../utils/paymentPollRunner');
const { fakeProvider } = require('./paymentLinkLifecycleFixture');

const settingsModel = { read: () => ({ companyName: 'Demo' }), decryptedSmtpSettings: () => ({}) };

function harness() {
  const mails = [];
  const notice = buildDatesTakenNotice({
    database: db, settingsModel, push: async () => {}, logger: { log: () => {}, warn: () => {} },
    emailServiceFactory: () => ({ isConfigured: true, send: async (m) => { mails.push(m); } }),
  });
  return { notice, mails };
}

let clientSeq = 0;
function newClient() {
  clientSeq += 1;
  return Number(db.prepare('INSERT INTO clients (firstName, lastName, email) VALUES (?, ?, ?)').run('Kilo', `Exemple${clientSeq}`, `kilo${clientSeq}@example.test`).lastInsertRowid);
}

function devisTaken(start) {
  const propertyId = freshProperty();
  const stayId = addStay({ propertyId, kind: 'devis', start: inDays(start), end: inDays(start + 4), extra: { clientId: newClient() } });
  const linkId = addLink(stayId);
  const takerId = addStay({ propertyId, platform: 'Booking', start: inDays(start + 1), end: inDays(start + 3), extra: { clientId: newClient() } });
  withdrawLinksOverlapping(db, { now: new Date() });
  return { propertyId, stayId, linkId, takerId };
}

const lookNow = async (linkId, provider, effect = {}) => {
  db.prepare('UPDATE payment_links SET lastLookAt = ? WHERE id = ? AND lastLookAt IS NOT NULL').run(new Date(Date.now() - 1000).toISOString(), linkId);
  return runLastLooks({ database: db, paymentLinksModel, provider, devisModel: require('../models/devisModel'), now: new Date(), ...effect });
};
const pendingLooks = () => require('../models/pluginsModel').buildModel(db).countPendingLastLooks();

test('rule 64 (R1) — a payment in flight 24 h after the withdrawal: re-reads stop, closed without a notice, one alert, uninstall released', async () => {
  const h = harness();
  const s = devisTaken(600);
  const inFlight = fakeProvider({ pending: true });
  const alerts = [];
  const notifyPaymentInFlight = async (link) => { alerts.push(link.id); };
  await providerReads(s.linkId, inFlight);
  assert.ok(linkOf(s.linkId).lastLookAt, 'within 24 h: read again');
  assert.ok(linkOf(s.linkId).withdrawnAt, 'the withdrawal is dated');
  const looksBefore = pendingLooks();
  db.prepare('UPDATE payment_links SET withdrawnAt = ? WHERE id = ?').run(new Date(Date.now() - 25 * 3600e3).toISOString(), s.linkId);
  await lookNow(s.linkId, inFlight, { notifyPaymentInFlight });
  const link = linkOf(s.linkId);
  assert.equal(link.lastLookAt, null, 'no more re-reads');
  assert.ok(link.noticeJudgedAt);
  assert.equal(link.noticeClosedReason, 'payment-in-flight');
  assert.deepEqual(alerts, [s.linkId]);
  assert.equal(pendingLooks(), looksBefore - 1, 'rule 52 — the uninstall is no longer blocked by it');
  const calls = inFlight.calls.length;
  await lookNow(s.linkId, inFlight, { notifyPaymentInFlight });
  assert.equal(inFlight.calls.length, calls, 'never read again');
  assert.deepEqual(alerts, [s.linkId], 'alerted once');
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
});

test('rule 64 (R1) — a stay whose link closed with a payment in flight is never told, even if another link reads unpaid', async () => {
  const h = harness();
  const s = devisTaken(610);
  const second = addLink(s.stayId, { type: 'balance' });
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'dates-taken', takenByReservationId = ?, remoteCancelPendingAt = NULL WHERE id = ?").run(s.takerId, second);
  db.prepare("UPDATE payment_links SET noticeJudgedAt = ?, noticeClosedReason = 'payment-in-flight', remoteCancelPendingAt = NULL WHERE id = ?").run(new Date().toISOString(), s.linkId);
  db.prepare('UPDATE payment_links SET unpaidReadAt = ? WHERE id = ?').run(new Date().toISOString(), second);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(linkOf(second).noticeClosedReason, 'payment-in-flight');
});

test('rule 52 (R1) — the guard names withdrawn links too', () => {
  const { lastLookBlocker } = require('../controllers/pluginsController').__test;
  assert.equal(lastLookBlocker(1).message, '1 lien retiré ou expiré dont le paiement reste à vérifier : réessayer plus tard.');
  assert.equal(lastLookBlocker(2).message, '2 liens retirés ou expirés dont le paiement reste à vérifier : réessayer plus tard.');
});

test('rule 64 (R2, Kilo) — a link withdrawn while it was minted never holds back the notice of the real withdrawal', async () => {
  const h = harness();
  const s = devisTaken(620);
  const minted = addLink(s.stayId, { type: 'balance' });
  const withdrawn = paymentLinksModel.cancelIfOpen(minted, { reason: 'dates-taken' });
  paymentLinksModel.closeForNotice(minted, 'never-sent');
  await require('../utils/paymentLinkDeactivation').deactivateAbandonedLinks([withdrawn], { paymentLinksModel, providerFor: () => fakeProvider() });
  assert.equal(linkOf(minted).remoteCancelPendingAt, null);
  assert.ok(linkOf(minted).lastLookAt, 'its payment is still read once after the deactivation');
  assert.equal(linkOf(minted).noticeClosedReason, 'never-sent');
  await providerReads(s.linkId, fakeProvider());
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1, 'the real withdrawal is told');
});

test('rule 64 (R2) — the mint that loses its nights closes its own link for the notice', async () => {
  const { storeUnlessNightsLost } = require('../utils/paymentRequestService').__test;
  const s = devisTaken(630);
  const deactivated = [];
  await assert.rejects(storeUnlessNightsLost({ database: db, paymentLinksModel }, s.stayId, {
    reservationId: s.stayId, type: 'balance', amountCents: 28000, provider: 'qonto', providerLinkId: 'pl_kilo', url: 'https://pay.example.test/kilo', status: 'open',
  }, async (links) => { deactivated.push(...links); }), (err) => err.error === 'DATES_UNAVAILABLE');
  const [row] = deactivated;
  assert.equal(linkOf(row.id).cancelReason, 'dates-taken');
  assert.equal(linkOf(row.id).noticeClosedReason, 'never-sent');
});

test('rule 64 (n5) — a link withdrawn before the taker was recorded is closed once, and no longer a candidate', async () => {
  const h = harness();
  const s = devisTaken(640);
  db.prepare('UPDATE payment_links SET takenByReservationId = NULL, remoteCancelPendingAt = NULL WHERE id = ?').run(s.linkId);
  const first = await h.notice.runDueNotices();
  assert.ok(first.some((r) => r.stayId === s.stayId && r.reason === 'no-taker'));
  assert.equal(linkOf(s.linkId).noticeClosedReason, 'no-taker');
  const second = await h.notice.runDueNotices();
  assert.ok(!second.some((r) => r.stayId === s.stayId));
  assert.equal(h.mails.length, 0);
});

test('rule 64 (n4) — a history row that cannot be written after SMTP acceptance: other templates keep their `failed` trace', async () => {
  const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');
  const propertyId = freshProperty();
  const stayId = addStay({ propertyId, start: inDays(650), end: inDays(652), extra: { clientId: newClient() } });
  let failNext = true;
  const logModel = { ...realLogModel, insert: (payload) => { if (payload.status === 'sent' && failNext) { failNext = false; throw new Error('disk I/O error'); } return realLogModel.insert(payload); } };
  const base = { database: db, templatesModel, logModel, settingsModel, emailServiceFactory: () => ({ send: async () => {} }), reservationId: stayId };
  const plain = await sendReservationTemplateEmail({ ...base, stableKey: 'deposit_reminder' });
  assert.equal(plain.sent, false);
  assert.equal(plain.accepted, undefined);
  const rows = db.prepare("SELECT status, errorMessage FROM email_log WHERE reservationId = ? ORDER BY id").all(stayId);
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ status: 'failed', errorMessage: 'disk I/O error' }]);
  failNext = true;
  const notice = await sendReservationTemplateEmail({ ...base, stableKey: 'dates_unavailable_notice', occurrenceKey: `dates-taken:${stayId}`, onAccepted: () => {} });
  assert.deepEqual({ sent: notice.sent, accepted: notice.accepted }, { sent: false, accepted: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM email_log WHERE reservationId = ?').get(stayId).n, 1, 'the notice leaves no misleading `failed` row');
});
