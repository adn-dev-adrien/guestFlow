// specs/plugins-phase-3a-online-payment.md rules 7–9 — no link GuestFlow abandons stays payable: it is
// deactivated at its provider; when the provider cannot, the poll retries, and a payment that still
// lands on it is never recorded on the stay — the admin is told, to refund it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const { deactivateAbandonedLinks } = require('../utils/paymentLinkDeactivation');
const { ensurePaymentLink } = require('../utils/paymentRequestService');
const { runPaymentPoll } = require('../utils/paymentPollRunner');
const notificationService = require('../utils/notificationService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount)
    VALUES ('reservation', 1, 1, '2026-11-10', '2026-11-12', 2, 300, 90, 210)`).run().lastInsertRowid);
  return { db, links: paymentLinksModel.buildModel(db), id };
}

function stubProvider({ cancelFails = false, paid = false } = {}) {
  const calls = [];
  return {
    calls,
    id: 'qonto',
    label: 'Qonto',
    createLink: async ({ amountCents }) => { calls.push(['create', amountCents]); return { id: `ql_${amountCents}`, url: 'https://pay/new', status: 'open', expiresAt: null }; },
    getPayment: async (linkId) => { calls.push(['payment', linkId]); return paid ? { paid: true, paymentId: 'pay_late', paidAt: '2026-11-01T10:00:00Z' } : { paid: false }; },
    getLinkStatus: async () => 'open',
    cancelLink: async (linkId) => {
      calls.push(['cancel', linkId]);
      if (cancelFails) throw new Error('provider unreachable');
    },
  };
}

const openLink = (links, reservationId, providerLinkId, amountCents = 9000) => links.create({
  reservationId, type: 'deposit', amountCents, provider: 'qonto', providerLinkId, url: `https://pay/${providerLinkId}`,
});

test('rule 7 — an abandoned link is deactivated at its provider', async () => {
  const { links, id } = seed();
  const link = links.updateStatus(openLink(links, id, 'ql_1').id, 'cancelled');
  const provider = stubProvider();
  const { notDeactivated } = await deactivateAbandonedLinks([link], { paymentLinksModel: links, providerFor: () => provider });
  assert.equal(notDeactivated, 0);
  assert.deepEqual(provider.calls, [['cancel', 'ql_1']]);
  assert.equal(links.findById(link.id).remoteCancelPendingAt, null);
});

test('rule 7 — when the provider cannot, the link is cancelled here and marked, and the action goes on', async () => {
  const { links, id } = seed();
  const a = links.updateStatus(openLink(links, id, 'ql_a').id, 'cancelled');
  const b = links.updateStatus(openLink(links, id, 'ql_b').id, 'cancelled');
  const down = await deactivateAbandonedLinks([a], { paymentLinksModel: links, providerFor: () => stubProvider({ cancelFails: true }) });
  const off = await deactivateAbandonedLinks([b], { paymentLinksModel: links, providerFor: () => null });
  assert.equal(down.notDeactivated, 1);
  assert.equal(off.notDeactivated, 1, 'plugin off: nothing to call, still owed');
  for (const row of [links.findById(a.id), links.findById(b.id)]) {
    assert.equal(row.status, 'cancelled');
    assert.ok(row.remoteCancelPendingAt);
  }
});

test('rule 7 — a link whose amount went stale is deactivated before the new one is minted', async () => {
  const { db, links, id } = seed();
  const stale = openLink(links, id, 'ql_stale', 9000);
  const provider = stubProvider();
  const link = await ensurePaymentLink({
    database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 12000,
  }, id, 'deposit');
  assert.deepEqual(provider.calls, [['cancel', 'ql_stale'], ['create', 12000]]);
  assert.equal(links.findById(stale.id).status, 'cancelled');
  assert.equal(link.amountCents, 12000);
});

test('rule 8 — the poll retries an owed deactivation, then forgets it', async () => {
  const { db, links, id } = seed();
  const row = links.cancel(openLink(links, id, 'ql_owed').id, { remotePending: true });
  const provider = stubProvider();
  const summary = await runPaymentPoll({ database: db, paymentLinksModel: links, provider, devisModel: {} });
  assert.deepEqual(provider.calls, [['payment', 'ql_owed'], ['cancel', 'ql_owed']]);
  assert.equal(summary.results[0].status, 'deactivated');
  assert.equal(links.findById(row.id).remoteCancelPendingAt, null);
  assert.equal(links.listRemoteCancelPending().length, 0);
});

test('rule 8 — a payment on an abandoned link is never recorded on the stay; the admin is told', async () => {
  const { db, links, id } = seed();
  const row = links.cancel(openLink(links, id, 'ql_owed').id, { remotePending: true });
  const told = [];
  const summary = await runPaymentPoll({
    database: db, paymentLinksModel: links, provider: stubProvider({ paid: true }), devisModel: {},
    notifyPaidAfterCancel: async (link) => { told.push(link.id); },
  });
  assert.equal(summary.results[0].status, 'paid-after-cancel');
  assert.deepEqual(told, [row.id]);
  const after = links.findById(row.id);
  assert.equal(after.status, 'cancelled');
  assert.equal(after.providerPaymentId, 'pay_late', 'kept for the refund');
  assert.equal(after.remoteCancelPendingAt, null);
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(id).depositPaid, 0);
});

test('rule 8 — a failing retry keeps the link owed for the next pass', async () => {
  const { db, links, id } = seed();
  const row = links.cancel(openLink(links, id, 'ql_owed').id, { remotePending: true });
  const summary = await runPaymentPoll({ database: db, paymentLinksModel: links, provider: stubProvider({ cancelFails: true }), devisModel: {} });
  assert.equal(summary.results[0].status, 'deactivation-pending');
  assert.ok(links.findById(row.id).remoteCancelPendingAt);
});

test('rule 8 — the admin email names the reservation, the amount and the refund to make', () => {
  const { buildPaidAfterCancelEmail } = notificationService.__test;
  const { subject, text } = buildPaidAfterCancelEmail(
    { id: 71, devisNumber: 'R-2026-071', propertyName: 'Le Lodge', startDate: '2026-11-10', endDate: '2026-11-12' },
    { amountCents: 82000 },
    'https://guestflow.example',
  );
  assert.match(subject, /Paiement reçu sur un lien annulé — R-2026-071 · 820,00/);
  assert.match(text, /n’est pas enregistré sur le séjour/);
  assert.match(text, /rembourser/);
  assert.match(text, /https:\/\/guestflow\.example\/reservations\/71/);
});
