// specs/plugins-phase-3a-online-payment.md rule 22 — a link whose bucket the stay settled another way
// (transfer, cash, platform) is abandoned like a stale one: it leaves the open links, is deactivated at
// the provider after a last « was it paid? » check, and the poll stops asking about it (mega review #5,
// M2: links 6 and 7 still open and polled on stays paid in July and August).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll } = require('../utils/paymentPollRunner');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const add = (balancePaid) => Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
      finalPrice, depositAmount, depositPaid, balanceAmount, balancePaid)
    VALUES ('reservation', 1, 1, '2026-08-10', '2026-08-12', 2, 300, 90, 1, 210, ?)`).run(balancePaid).lastInsertRowid);
  return { db, paidId: add(1), unpaidId: add(0) };
}

function provider({ paid = false } = {}) {
  const calls = [];
  return {
    calls,
    id: 'qonto',
    getPayment: async (linkId, ctx) => { calls.push(['getPayment', linkId, ctx && ctx.origin]); return paid ? { paid: true, paymentId: 'pay_9' } : { paid: false }; },
    getLinkStatus: async (linkId) => { calls.push(['getLinkStatus', linkId]); return 'open'; },
    cancelLink: async (linkId) => { calls.push(['cancelLink', linkId]); },
  };
}

test('rule 22 — retireSettled cancels only the links whose bucket is settled, with the deactivation owed', () => {
  const { db, paidId, unpaidId } = seed();
  const links = paymentLinksModel.buildModel(db);
  const settled = links.create({ reservationId: paidId, type: 'balance', amountCents: 21000, providerLinkId: 'ql_6', url: 'https://pay/6' });
  const open = links.create({ reservationId: unpaidId, type: 'balance', amountCents: 21000, providerLinkId: 'ql_7', url: 'https://pay/7' });
  const retired = links.retireSettled();
  assert.deepEqual(retired.map((l) => l.id), [settled.id]);
  assert.equal(links.findById(settled.id).status, 'cancelled');
  assert.ok(links.findById(settled.id).remoteCancelPendingAt, 'the provider deactivation is owed');
  assert.equal(links.findById(open.id).status, 'open');
  assert.deepEqual(links.retireSettled(), [], 'idempotent');
});

test('rule 22 — the poll deactivates the settled link and never polls it again', async () => {
  const { db, paidId } = seed();
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: paidId, type: 'balance', amountCents: 21000, providerLinkId: 'ql_6', url: 'https://pay/6' });
  const p = provider();
  const first = await runPaymentPoll({ database: db, paymentLinksModel: links, provider: p, devisModel: devisModel.buildModel(db), force: true });
  assert.equal(first.settled, 1);
  assert.equal(first.checked, 0, 'a settled link is no longer checked as an open one');
  assert.deepEqual(p.calls.map((c) => c[0]), ['getPayment', 'cancelLink'], 'checked once for a payment, then deactivated');
  assert.equal(links.findById(link.id).remoteCancelPendingAt, null);

  p.calls.length = 0;
  const second = await runPaymentPoll({ database: db, paymentLinksModel: links, provider: p, devisModel: devisModel.buildModel(db), force: true });
  assert.equal(second.checked, 0);
  assert.deepEqual(p.calls, [], 'nothing left to ask the provider');
});

test('rule 22 — paid at the provider after the bucket was settled another way: not deactivated, kept for the refund', async () => {
  const { db, paidId } = seed();
  // Settled by transfer on 1 August; the link payment (pay_9, now) comes later (rule 23).
  db.prepare("UPDATE reservations SET balancePaidDate = '2026-08-01' WHERE id = ?").run(paidId);
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: paidId, type: 'balance', amountCents: 21000, providerLinkId: 'ql_6', url: 'https://pay/6' });
  const notified = [];
  const p = provider({ paid: true });
  await runPaymentPoll({ database: db, paymentLinksModel: links, provider: p, devisModel: devisModel.buildModel(db), force: true, notifyPaidAfterCancel: async (l) => notified.push(l.id) });
  assert.deepEqual(p.calls.map((c) => c[0]), ['getPayment']);
  assert.equal(links.findById(link.id).providerPaymentId, 'pay_9');
  assert.deepEqual(notified, [link.id]);
  assert.equal(links.findById(link.id).status, 'cancelled');
});
