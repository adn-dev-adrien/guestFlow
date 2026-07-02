// Payment poll runner (specs/online-payments-qonto.md §3.3/§3.4): a PAID deposit link on a devis
// converts it to a reservation and flags the deposit paid; idempotent; expired links are recorded.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll, processPaidLink } = require('../utils/paymentPollRunner');

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

test('a paid deposit link → calls sendConfirmation with the converted reservation id', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: devisId, type: 'deposit', amountCents: 9000, qontoPaymentLinkId: 'ql_1', url: 'u', status: 'open' });

  const calls = [];
  await runPaymentPoll({ ...deps(db, 'paid'), sendConfirmation: async (id) => { calls.push(id); } });

  const convertedId = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(devisId).convertedReservationId;
  assert.deepEqual(calls, [convertedId], 'confirmation sent once, for the real reservation');
});

test('a paid balance link → does NOT send a confirmation (it is a later top-up, not the initial confirmation)', async () => {
  const { db, devisId } = seed();
  // Convert the devis to a reservation first so a balance link targets a real stay.
  const conv = devisModel.buildModel(db).convertToReservation(devisId);
  const resaId = conv.data.reservationId;
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: resaId, type: 'balance', amountCents: 21000, qontoPaymentLinkId: 'ql_bal', url: 'u', status: 'open' });

  const calls = [];
  await runPaymentPoll({ ...deps(db, 'paid'), sendConfirmation: async (id) => { calls.push(id); } });

  assert.equal(db.prepare('SELECT balancePaid FROM reservations WHERE id = ?').get(resaId).balancePaid, 1);
  assert.deepEqual(calls, [], 'no confirmation for a balance payment');
});

test('a confirmation that throws never breaks the poll (best-effort)', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId: devisId, type: 'deposit', amountCents: 9000, qontoPaymentLinkId: 'ql_1', url: 'u', status: 'open' });

  const summary = await runPaymentPoll({ ...deps(db, 'paid'), sendConfirmation: async () => { throw new Error('SMTP down'); } });
  assert.equal(summary.paid, 1, 'the link is still marked paid despite the email error');
  assert.equal(db.prepare('SELECT status FROM payment_links WHERE id = ?').get(link.id).status, 'paid');
});

test('a paid FULL link on a devis → converts it + marks fully paid (deposit + balance)', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: devisId, type: 'full', amountCents: 30000, qontoPaymentLinkId: 'ql_full', url: 'u', status: 'open' });

  await runPaymentPoll(deps(db, 'paid'));

  const devis = db.prepare('SELECT devisStatus, convertedReservationId FROM reservations WHERE id = ?').get(devisId);
  assert.equal(devis.devisStatus, 'converted');
  const resa = db.prepare('SELECT depositPaid, balancePaid, balancePaidDate FROM reservations WHERE id = ?').get(devis.convertedReservationId);
  assert.equal(resa.depositPaid, 1);
  assert.equal(resa.balancePaid, 1, 'full payment settles the balance too');
  assert.ok(resa.balancePaidDate, 'balancePaidDate stamped');
});

test('a paid FULL link on a devis with a date conflict → flags bookingConflictAt + notifies the admin', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: devisId, type: 'full', amountCents: 30000, qontoPaymentLinkId: 'ql_full', url: 'u', status: 'open' });

  const notified = [];
  await runPaymentPoll({ ...deps(db, 'paid'), checkConflict: () => true, notifyConflict: (id) => { notified.push(id); } });

  const devis = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(devisId);
  const resa = db.prepare('SELECT bookingConflictAt FROM reservations WHERE id = ?').get(devis.convertedReservationId);
  assert.ok(resa.bookingConflictAt, 'conflict stamped on the converted reservation');
  assert.deepEqual(notified, [devis.convertedReservationId], 'admin notified once with the reservation id');
});

test('no conflict → bookingConflictAt stays null, admin not notified', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  links.create({ reservationId: devisId, type: 'full', amountCents: 30000, qontoPaymentLinkId: 'ql_full', url: 'u', status: 'open' });

  const notified = [];
  await runPaymentPoll({ ...deps(db, 'paid'), checkConflict: () => false, notifyConflict: (id) => { notified.push(id); } });

  const devis = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(devisId);
  const resa = db.prepare('SELECT bookingConflictAt FROM reservations WHERE id = ?').get(devis.convertedReservationId);
  assert.equal(resa.bookingConflictAt, null);
  assert.deepEqual(notified, []);
});

test('concurrent processPaidLink on the same paid link (webhook + poll race) → converts once, one email, one conflict notify', async () => {
  const { db, devisId } = seed();
  const links = paymentLinksModel.buildModel(db);
  // Both the webhook and the on-demand poll captured the SAME still-open link before either flipped it.
  const link = links.create({ reservationId: devisId, type: 'full', amountCents: 30000, qontoPaymentLinkId: 'ql_full', url: 'u', status: 'open' });
  const captured = { id: link.id, reservationId: devisId, type: 'full', qontoPaymentLinkId: 'ql_full' };

  const emails = [];
  const notified = [];
  const deps = {
    database: db,
    devisModel: devisModel.buildModel(db),
    paymentLinksModel: links,
    checkConflict: () => true,
    sendConfirmation: async (id) => { emails.push(id); },
    notifyConflict: (id) => { notified.push(id); },
    paidPayment: { id: 'pay_1', paid_at: '2026-09-21T10:00:00Z' },
  };

  const first = await processPaidLink({ ...deps, link: captured });
  const second = await processPaidLink({ ...deps, link: captured });

  assert.equal(first.effect, 'converted');
  assert.equal(second.effect, 'already-processed', 'the second caller no-ops (markPaid did not flip)');

  const converted = db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE kind = 'reservation'").get().c;
  assert.equal(converted, 1, 'exactly one reservation created');
  assert.deepEqual(emails, [first.reservationId], 'confirmation email sent exactly once');
  assert.deepEqual(notified, [first.reservationId], 'conflict alert sent exactly once');
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
