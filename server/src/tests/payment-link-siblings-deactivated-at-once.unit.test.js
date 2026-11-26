// specs/payments/payment-link-lifecycle.md rule 70 — when a payment settles a bucket, the other open links of that
// bucket are deactivated at the provider in the SAME pass; a failed call leaves the deactivation owed (next pass).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll } = require('../utils/paymentPollRunner');
const { migratePaymentLinksToProviders } = require('../utils/paymentLinksProviderMigration');

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
  const paying = links.create({ reservationId: id, type: 'balance', amountCents: 30000, providerLinkId: 'pl_paying', url: 'https://pay/1' });
  const sibling = links.create({ reservationId: id, type: 'balance', amountCents: 30000, providerLinkId: 'pl_sibling', url: 'https://pay/2' });
  migratePaymentLinksToProviders(db);
  return { db, id, links, paying, sibling };
}

function provider({ failCancel = false } = {}) {
  const calls = [];
  return {
    calls,
    id: 'qonto',
    getPayment: async (linkId) => {
      calls.push(['getPayment', linkId]);
      return linkId === 'pl_paying' ? { paid: true, paymentId: 'pay_1', paidAt: new Date().toISOString() } : { paid: false };
    },
    getLinkStatus: async () => 'open',
    cancelLink: async (linkId) => {
      calls.push(['cancelLink', linkId]);
      if (failCancel) throw new Error('provider down');
    },
  };
}

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const poll = async (db, links, p) => {
  const out = await runPaymentPoll({ database: db, paymentLinksModel: links, provider: p, devisModel: devisModel.buildModel(db), force: true });
  await settle();
  return out;
};

test('rule 70: the sibling is deactivated in the same pass as the payment', async () => {
  const { db, links, paying, sibling } = seed();
  const p = provider();
  await poll(db, links, p);
  assert.equal(links.findById(paying.id).status, 'paid');
  const row = links.findById(sibling.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.cancelReason, 'settled');
  assert.equal(row.remoteCancelPendingAt, null, 'nothing left owed');
  assert.deepEqual(p.calls.filter((c) => c[0] === 'cancelLink'), [['cancelLink', 'pl_sibling']]);
});

test('rule 70: a failed immediate call leaves the deactivation owed, and the next pass completes it', async () => {
  const { db, links, sibling } = seed();
  await poll(db, links, provider({ failCancel: true }));
  const owed = links.findById(sibling.id);
  assert.equal(owed.status, 'cancelled');
  assert.ok(owed.remoteCancelPendingAt, 'still owed');

  const p = provider();
  await poll(db, links, p);
  assert.equal(links.findById(sibling.id).remoteCancelPendingAt, null);
  assert.ok(p.calls.some((c) => c[0] === 'cancelLink' && c[1] === 'pl_sibling'));
});
