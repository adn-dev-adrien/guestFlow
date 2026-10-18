// specs/plugins-phase-3a-online-payment.md rule 23 — a link retired by rule 22 and then found paid at
// the provider is, most of the time, the very payment the operator ticked by hand before the webhook
// arrived: it becomes `paid`, nothing is recorded twice and nobody is asked to refund. Only a bucket
// recorded paid on an earlier day than the link payment raises an alert, worded « à vérifier »
// (review of PR #702, major 2).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll } = require('../utils/paymentPollRunner');
const { migratePaymentLinksToProviders } = require('../utils/paymentLinksProviderMigration');
const notificationService = require('../utils/notificationService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
      finalPrice, depositAmount, depositPaid, balanceAmount, balancePaid)
    VALUES ('reservation', 1, 1, '2026-11-10', '2026-11-12', 2, 300, 0, 0, 300, 0)`).run().lastInsertRowid);
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: id, type: 'balance', amountCents: 30000, providerLinkId: 'pl_1', url: 'https://pay/1' });
  return { db, id, links, link };
}

function provider(paidAt) {
  const calls = [];
  return {
    calls,
    id: 'qonto',
    getPayment: async (linkId) => { calls.push(['getPayment', linkId]); return { paid: true, paymentId: 'pay_1', paidAt }; },
    getLinkStatus: async () => 'open',
    cancelLink: async (linkId) => { calls.push(['cancelLink', linkId]); },
  };
}

const tickBalance = (db, id, date) => db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(date, id);

test('rule 23 — the operator ticked the solde on seeing the money: the link is the payment, no refund alert', async () => {
  const { db, id, links, link } = seed();
  tickBalance(db, id, '2026-10-18');
  assert.equal(links.retireSettled().length, 1);
  assert.equal(links.findById(link.id).cancelReason, 'settled');

  const notified = [];
  const recorded = [];
  const paidAt = new Date(2026, 9, 17, 23, 30).toISOString(); // 23:30 local on the 17th, ticked the next morning
  const p = provider(paidAt);
  const summary = await runPaymentPoll({
    database: db, paymentLinksModel: links, provider: p, devisModel: devisModel.buildModel(db), force: true,
    notifyPaidAfterCancel: async (l, o) => notified.push([l.id, o]),
    recordPayment: (payment) => recorded.push(payment),
  });

  assert.deepEqual(notified, [], 'no « rembourser » alert for the single payment');
  assert.deepEqual(p.calls.map((c) => c[0]), ['getPayment'], 'a paid link is never deactivated');
  const row = links.findById(link.id);
  assert.equal(row.status, 'paid');
  assert.equal(row.providerPaymentId, 'pay_1');
  assert.equal(row.remoteCancelPendingAt, null);
  assert.equal(summary.results.find((r) => r.id === link.id).status, 'paid');
  assert.deepEqual(recorded, [{ reservationId: id, bucket: 'balance', paidDate: '2026-10-17' }], 'through the idempotent recorder');

  p.calls.length = 0;
  await runPaymentPoll({ database: db, paymentLinksModel: links, provider: p, devisModel: devisModel.buildModel(db), force: true });
  assert.deepEqual(p.calls, [], 'nothing left to ask');
});

test('rule 23 — the real recorder leaves an already-paid solde and its date untouched', async () => {
  const { db, id, links } = seed();
  tickBalance(db, id, '2026-10-18');
  links.retireSettled();
  await runPaymentPoll({ database: db, paymentLinksModel: links, provider: provider('2026-10-18T08:00:00Z'), devisModel: devisModel.buildModel(db), force: true });
  const r = db.prepare('SELECT balancePaid, balancePaidDate FROM reservations WHERE id = ?').get(id);
  assert.deepEqual({ ...r }, { balancePaid: 1, balancePaidDate: '2026-10-18' });
});

test('rule 23 — settled on an earlier day than the link payment: kept for a refund, the alert says « à vérifier »', async () => {
  const { db, id, links, link } = seed();
  tickBalance(db, id, '2026-10-10');
  links.retireSettled();
  const notified = [];
  const summary = await runPaymentPoll({
    database: db, paymentLinksModel: links, provider: provider('2026-10-18T08:00:00Z'), devisModel: devisModel.buildModel(db), force: true,
    notifyPaidAfterCancel: async (l, o) => notified.push([l.id, o]),
    recordPayment: () => { throw new Error('never recorded twice'); },
  });
  assert.deepEqual(notified, [[link.id, { settledOn: '2026-10-10' }]]);
  const row = links.findById(link.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.providerPaymentId, 'pay_1');
  assert.equal(row.remoteCancelPendingAt, null);
  assert.equal(summary.results.find((r) => r.id === link.id).status, 'paid-after-settled');
});

test('rule 23 — a link cancelled for another reason keeps the rule 8 refund alert', async () => {
  const { db, links, link } = seed();
  links.cancel(link.id, { remotePending: true });
  const notified = [];
  await runPaymentPoll({ database: db, paymentLinksModel: links, provider: provider('2026-10-18T08:00:00Z'), devisModel: devisModel.buildModel(db), force: true, notifyPaidAfterCancel: async (l, o) => notified.push([l.id, o]) });
  assert.deepEqual(notified, [[link.id, undefined]]);
  assert.equal(links.findById(link.id).status, 'cancelled');
});

test('rule 23 — the « à vérifier » email names the earlier settlement and does not order a refund', () => {
  const { buildPaidAfterCancelEmail } = notificationService.__test;
  const { subject, text } = buildPaidAfterCancelEmail(
    { id: 71, devisNumber: 'R-2026-071', propertyName: 'Le Lodge', startDate: '2026-11-10', endDate: '2026-11-12' },
    { amountCents: 30000 },
    '',
    { settledOn: '2026-10-10' },
  );
  assert.match(subject, /Paiement à vérifier sur un lien retiré — R-2026-071 · 300,00/);
  assert.match(text, /déjà noté réglé le 10\/10\/2026/);
  assert.match(text, /À vérifier/);
  assert.doesNotMatch(text, /Action requise/);
});

test('rule 23 — the upgrade adds cancelReason to an existing table, idempotently', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payment_links (id INTEGER PRIMARY KEY, reservationId INTEGER, type TEXT, providerLinkId TEXT,
    provider TEXT NOT NULL DEFAULT 'qonto', remoteCancelPendingAt TEXT, status TEXT)`);
  migratePaymentLinksToProviders(db);
  migratePaymentLinksToProviders(db);
  assert.ok(db.prepare('PRAGMA table_info(payment_links)').all().some((c) => c.name === 'cancelReason'));
});
