// Payment poll runner (specs/online-payments-qonto.md §3.3/§3.4): a PAID deposit link on a devis
// converts it to a reservation and flags the deposit paid; idempotent; expired links are recorded.

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
  // A devis with a 90€ deposit.
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
                            finalPrice, depositAmount, balanceAmount, devisStatus)
                           VALUES ('devis', 1, 1, '2026-08-10', '2026-08-12', 2, 300, 90, 210, 'draft')`).run();
  return { db, devisId: Number(info.lastInsertRowid) };
}

// A qontoClient stub: the payments sub-resource is the authoritative paid signal; the link status
// covers the expired/cancelled cases. `outcome` ∈ 'paid' | 'open' | 'expired'.
function qontoStub(outcome) {
  return {
    getPaymentLinkPayments: async () => (outcome === 'paid'
      ? { paid: true, paidPayment: { id: 'pay_remote_1', paid_at: '2026-09-21T10:00:00Z' }, payments: [{ status: 'paid' }] }
      : { paid: false, paidPayment: null, payments: [] }),
    getPaymentLink: async ({ id }) => ({ id, mappedStatus: outcome === 'paid' ? 'processing' : outcome, raw: {} }),
  };
}

const deps = (db, outcome) => ({
  database: db,
  paymentLinksModel: paymentLinksModel.buildModel(db),
  devisModel: devisModel.buildModel(db),
  qontoClient: qontoStub(outcome),
  getAccessToken: async () => 'tok_test',
});

test('a paid deposit link on a devis → converts it + flags the new reservation deposit paid', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: devisId, type: 'deposit', amountCents: 9000, qontoPaymentLinkId: 'ql_1', url: 'https://pay/ql_1', status: 'open' });

  const summary = await runPaymentPoll(deps(db, 'paid'));
  assert.equal(summary.checked, 1);
  assert.equal(summary.paid, 1);

  // The devis is now converted.
  const devis = db.prepare('SELECT devisStatus, convertedReservationId FROM reservations WHERE id = ?').get(devisId);
  assert.equal(devis.devisStatus, 'converted');
  assert.ok(devis.convertedReservationId, 'a real reservation was created');

  // The new reservation carries the paid deposit.
  const resa = db.prepare('SELECT kind, depositPaid, depositPaidDate FROM reservations WHERE id = ?').get(devis.convertedReservationId);
  assert.equal(resa.kind, 'reservation');
  assert.equal(resa.depositPaid, 1);
  assert.ok(resa.depositPaidDate, 'depositPaidDate stamped');

  // The link is marked paid.
  assert.equal(db.prepare('SELECT status FROM payment_links WHERE id = ?').get(link.id).status, 'paid');
});

test('idempotent: a second pass does nothing (the paid link is no longer open)', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: devisId, type: 'deposit', amountCents: 9000, qontoPaymentLinkId: 'ql_1', url: 'u', status: 'open' });

  await runPaymentPoll(deps(db, 'paid'));
  const convertedCount1 = db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE kind = 'reservation'").get().c;
  const second = await runPaymentPoll(deps(db, 'paid'));
  assert.equal(second.checked, 0, 'no open links remain');
  const convertedCount2 = db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE kind = 'reservation'").get().c;
  assert.equal(convertedCount2, convertedCount1, 'no second conversion');
});

test('an open link stays open; an expired link is recorded', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  const a = links.create({ reservationId: devisId, type: 'deposit', amountCents: 9000, qontoPaymentLinkId: 'ql_open', url: 'u', status: 'open' });
  assert.equal((await runPaymentPoll(deps(db, 'open'))).paid, 0);
  assert.equal(db.prepare('SELECT status FROM payment_links WHERE id = ?').get(a.id).status, 'open');

  await runPaymentPoll(deps(db, 'expired'));
  assert.equal(db.prepare('SELECT status FROM payment_links WHERE id = ?').get(a.id).status, 'expired');
});
