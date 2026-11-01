// specs/payment-link-lifecycle.md rule 64, reading of 2026-11-01 (audit R11 external R11-E1). The guest notice says
// « rien ne vous a été prélevé » only after the read that follows the deactivation of a link withdrawn for taken dates
// found no payment, final or in flight. A provider whose `getPayment` does not say `pending` (a boolean) — online-payment
// 1.5.0, which still loads on this core — cannot say that: the core counts its unpaid answer as in flight. The read
// stays owed, the notice waits, and 24 h after the withdrawal the link is closed for the notice with the operator's
// alert (R1). A lapsed link (`expired`) keeps its one last look: nothing is sent to anyone on it. Rule 63 (R11 M1): a
// taken-dates payment held beside a plan, even refunded, is money on the stay (rule 31: `paidAt`), so the stay is never
// told « rien prélevé »; its admin alert says to refund it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf, providerReads } = require('./datesTakenFixture');
const paymentLinksModel = require('../models/paymentLinksModel');
const { buildDatesTakenNotice } = require('../utils/datesTakenNotice');
const { withdrawLinksOverlapping } = require('../utils/paymentLinkLifecycle');
const { runLastLooks } = require('../utils/paymentPollRunner');
const { settleWithdrawnPayment } = require('../utils/withdrawnPayments');

// What online-payment 1.5.0 answers for a Qonto payment still `processing`: no `pending` key.
const QONTO_V150 = { paid: false, paymentId: null, paidAt: null };
function provider(answer) {
  const calls = [];
  return {
    calls, id: 'qonto', label: 'Qonto', isReady: () => true,
    getPayment: async (linkId) => { calls.push(['getPayment', linkId]); return { ...answer }; },
    cancelLink: async (linkId) => { calls.push(['cancelLink', linkId]); },
    getLinkStatus: async () => 'cancelled',
  };
}

function harness() {
  const mails = [];
  const notice = buildDatesTakenNotice({
    database: db, settingsModel: { read: () => ({ companyName: 'Demo' }), decryptedSmtpSettings: () => ({}) },
    push: async () => {}, logger: { log: () => {}, warn: () => {} },
    emailServiceFactory: () => ({ isConfigured: true, send: async (m) => { mails.push(m); } }),
  });
  return { notice, mails };
}

let clientSeq = 0;
const newClient = () => {
  clientSeq += 1;
  return Number(db.prepare('INSERT INTO clients (firstName, lastName, email) VALUES (?, ?, ?)').run('Lima', `Exemple${clientSeq}`, `lima${clientSeq}@example.test`).lastInsertRowid);
};

// A devis whose acompte link a direct stay with an acompte (another client) took: withdrawn, deactivation owed.
function devisTaken(start) {
  const propertyId = freshProperty();
  const stayId = addStay({ propertyId, kind: 'devis', start: inDays(start), end: inDays(start + 4), extra: { clientId: newClient() } });
  const linkId = addLink(stayId);
  addStay({ propertyId, depositPaid: 1, start: inDays(start + 1), end: inDays(start + 3), extra: { clientId: newClient() } });
  withdrawLinksOverlapping(db, { now: new Date() });
  return { stayId, linkId };
}

// The pass reads every due link of the suite's database: each test counts its own guest's mail and its own result.
const emailOf = (stayId) => db.prepare('SELECT c.email FROM reservations r JOIN clients c ON c.id = r.clientId WHERE r.id = ?').get(stayId).email;
const mailsTo = (h, stayId) => h.mails.filter((m) => JSON.stringify(m).includes(emailOf(stayId))).length;

const lookNow = (linkId, p, effect = {}) => {
  db.prepare('UPDATE payment_links SET lastLookAt = ? WHERE id = ? AND lastLookAt IS NOT NULL').run(new Date(Date.now() - 1000).toISOString(), linkId);
  return runLastLooks({ database: db, paymentLinksModel, provider: p, devisModel: require('../models/devisModel'), now: new Date(), ...effect });
};

for (const [name, answer] of [['no `pending` key', QONTO_V150], ['a `pending` that is not a boolean', { paid: false, pending: 'processing' }]]) {
  test(`rule 64 (R11-E1): ${name} after the deactivation is a payment in flight — read again, no notice`, async () => {
    const h = harness();
    const s = devisTaken(name.startsWith('no') ? 700 : 705);
    const p = provider(answer);
    await providerReads(s.linkId, p);
    const link = linkOf(s.linkId);
    assert.equal(link.unpaidReadAt, null, 'never read as unpaid');
    assert.ok(link.lastLookAt, 'the read stays owed');
    await h.notice.runDueNotices();
    assert.equal(mailsTo(h, s.stayId), 0);
  });
}

test('rule 64 (R11-E1): still unsaid 24 h after the withdrawal — closed for the notice, the operator alerted once, nobody told', async () => {
  const h = harness();
  const s = devisTaken(710);
  const p = provider(QONTO_V150);
  await providerReads(s.linkId, p);
  db.prepare('UPDATE payment_links SET withdrawnAt = ? WHERE id = ?').run(new Date(Date.now() - 25 * 3600e3).toISOString(), s.linkId);
  const alerts = [];
  const out = await lookNow(s.linkId, p, { notifyPaymentInFlight: async (l) => { alerts.push(l.id); } });
  assert.equal(out.results.find((r) => r.id === s.linkId).closed, 'payment-in-flight');
  assert.equal(linkOf(s.linkId).noticeClosedReason, 'payment-in-flight');
  assert.equal(linkOf(s.linkId).lastLookAt, null);
  assert.deepEqual(alerts, [s.linkId]);
  await h.notice.runDueNotices();
  assert.equal(mailsTo(h, s.stayId), 0);
});

test('rule 64 (R11-E1): `pending: false` still reads the link unpaid and the notice leaves', async () => {
  const h = harness();
  const s = devisTaken(720);
  await providerReads(s.linkId, provider({ paid: false, pending: false }));
  assert.ok(linkOf(s.linkId).unpaidReadAt);
  await h.notice.runDueNotices();
  assert.equal(mailsTo(h, s.stayId), 1);
});

test('rule 19 (R11-E1): a lapsed link answered without `pending` keeps its one last look', async () => {
  const propertyId = freshProperty();
  const stayId = addStay({ propertyId, start: inDays(730), end: inDays(733) });
  const linkId = addLink(stayId);
  db.prepare("UPDATE payment_links SET status = 'expired', cancelReason = 'validity', remoteCancelPendingAt = NULL, lastLookAt = ? WHERE id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), linkId);
  const p = provider(QONTO_V150);
  await lookNow(linkId, p);
  await lookNow(linkId, p);
  assert.equal(p.calls.length, 1, 'read once, never again');
  assert.equal(linkOf(linkId).lastLookAt, null);
});

test('rule 63 (R11): a taken-dates payment held beside a plan, then refunded, keeps the stay from « rien ne vous a été prélevé »', async () => {
  const h = harness();
  const propertyId = freshProperty();
  // A direct stay with a plan (nothing paid on it) whose acompte link another stay's acompte took.
  const stayId = addStay({ propertyId, start: inDays(740), end: inDays(744), extra: { clientId: newClient() } });
  db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents) VALUES (?, 1, ?, 40000)').run(stayId, inDays(400));
  const linkId = addLink(stayId);
  addStay({ propertyId, depositPaid: 1, start: inDays(741), end: inDays(743), extra: { clientId: newClient() } });
  withdrawLinksOverlapping(db, { now: new Date() });
  assert.equal(linkOf(linkId).cancelReason, 'dates-taken');
  // Its payment lands before the deactivation: held on the link, never on the buckets.
  await providerReads(linkId, provider({ paid: true, paymentId: 'pay_held', paidAt: new Date().toISOString() }), { lastLook: false });
  const held = linkOf(linkId);
  assert.equal(held.status, 'cancelled');
  assert.ok(held.paidAt);
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(stayId).depositPaid, 0);
  await settleWithdrawnPayment(linkId, { database: db, paymentLinksModel, outcome: 'refunded', bookPaid: async () => { throw new Error('must not book'); } });
  assert.equal(linkOf(linkId).cancelReason, 'refunded');
  await h.notice.runDueNotices();
  assert.equal(mailsTo(h, stayId), 0);
});

test('rule 63 (R11): the admin alert of a payment held beside a plan says to refund it', () => {
  const { buildPaidAfterCancelEmail } = require('../utils/notificationService').__test;
  const email = buildPaidAfterCancelEmail({ id: 9, kind: 'reservation', propertyName: 'Gîte', startDate: inDays(30), endDate: inDays(33) }, { id: 1, type: 'full', amountCents: 100150 }, '', { installmentPlan: true });
  assert.match(email.subject, /^⚠️ Paiement à rembourser : échéancier en place — #9 · 1\s001,50\s€$/);
  assert.match(email.text, /Action requise : rembourser ce paiement, ou supprimer l’échéancier pour l’enregistrer sur le séjour\./);
});
