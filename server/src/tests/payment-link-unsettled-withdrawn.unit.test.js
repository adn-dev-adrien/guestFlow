// specs/payment-link-lifecycle.md rule 56 (decided by Adrien 2026-10-31) — a link withdrawn by hand and paid AFTER
// its withdrawal (rule-8 alert, money not counted for the stay) blocks every new payment request of the stay until
// the operator settles it: refunded (`cancelReason = 'refunded'`), or recorded as the stay's money (`paid`).

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider, spies } = require('./paymentLinkLifecycleFixture');
const { ensurePaymentLink, ensureInstallmentLink } = require('../utils/paymentRequestService');
const { withdrawPaymentLink } = require('../utils/paymentLinkWithdrawal');
const { retryPendingCancellations } = require('../utils/paymentPollRunner');
const { settleWithdrawnPayment } = require('../utils/withdrawnPayments');
const { buildLedger } = require('../utils/reservationLedger');
const devisModel = require('../models/devisModel');
const { emailsFixture, teardown } = require('./paymentLinkEmailsFixture');
const { localIsoDate } = require('../utils/localDate');

test.afterEach(teardown);

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const MESSAGE = 'Paiement reçu sur un lien retiré : à traiter avant toute nouvelle demande.';
const refused = (err) => err.httpStatus === 409 && err.error === 'UNSETTLED_WITHDRAWN_PAYMENT' && err.message === MESSAGE;

// A deposit link withdrawn while the provider was disconnected, then paid a minute after its withdrawal.
async function paidAfterWithdrawal(db, links, stayId) {
  const link = addLink(links, db, stayId, { type: 'deposit' });
  const at = new Date();
  await withdrawPaymentLink(link.id, { database: db, paymentLinksModel: links, provider: null, bookPaid: async () => {}, now: at });
  const provider = fakeProvider({ paid: true, paidAt: new Date(at.getTime() + 60 * 1000).toISOString() });
  await retryPendingCancellations({ paymentLinksModel: links, provider, database: db, devisModel: devisModel.buildModel(db), logger: { log() {}, warn() {} }, ...spies() });
  return links.findById(link.id);
}

async function setup() {
  const { db, links } = seedDb();
  const id = addStay(db, { startDate: inDays(40), endDate: inDays(43) });
  const link = await paidAfterWithdrawal(db, links, id);
  const provider = fakeProvider();
  const deps = { database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 21000 };
  return { db, links, id, link, provider, deps };
}

test('rule 56: the rule-8 money stays off the stay, and the next request of any bucket is refused before any provider call', async () => {
  const { db, id, link, provider, deps } = await setup();
  assert.equal(link.status, 'cancelled');
  assert.ok(link.paidAt);
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(id).depositPaid, 0);
  await assert.rejects(ensurePaymentLink(deps, id, 'balance'), refused);
  await assert.rejects(ensurePaymentLink(deps, id, 'deposit'), refused);
  assert.deepEqual(provider.calls, []);
});

test('rule 56: an échéance of the stay is refused too', async () => {
  const { id, provider, deps } = await setup();
  const installment = { id: 41, reservationId: id, number: 1, amountCents: 15000, paid: 0 };
  const installmentsModel = { findById: () => installment, listFor: () => [installment] };
  await assert.rejects(ensureInstallmentLink({ ...deps, installmentsModel }, id, 41), refused);
  assert.deepEqual(provider.calls, []);
});

test('rule 56: the request e-mail is refused before any mint, nothing sent', async () => {
  const f = emailsFixture();
  await paidAfterWithdrawal(f.db, f.links, f.id);
  const r = await f.send('balance_request');
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'UNSETTLED_WITHDRAWN_PAYMENT');
  assert.equal(r.body.message, MESSAGE);
  assert.deepEqual(f.minted, []);
  assert.equal(f.sent.length, 0);
});

test('rule 56: « remboursé » settles it — reason `refunded`, the money still off the stay, requests free again', async () => {
  const { db, links, id, link, deps } = await setup();
  const { link: after } = await settleWithdrawnPayment(link.id, { database: db, paymentLinksModel: links, outcome: 'refunded', bookPaid: async () => { throw new Error('not booked'); } });
  assert.equal(after.status, 'cancelled');
  assert.equal(after.cancelReason, 'refunded');
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(id).depositPaid, 0);
  assert.equal((await ensurePaymentLink(deps, id, 'balance')).reused, false);
});

test('rule 56: « enregistrer sur le séjour » settles it — booked through the late-booking path, requests free again', async () => {
  const { db, links, id, link, deps } = await setup();
  const booked = [];
  await settleWithdrawnPayment(link.id, {
    database: db, paymentLinksModel: links, outcome: 'stay',
    bookPaid: async (l, pay) => { booked.push([l.id, pay.paymentId, pay.paidAt]); links.markRetiredLinkPaid(l.id, { providerPaymentId: pay.paymentId, paidAt: pay.paidAt, reason: 'operator' }); },
  });
  assert.deepEqual(booked, [[link.id, link.providerPaymentId, link.paidAt]]);
  assert.equal(links.findById(link.id).status, 'paid');
  assert.equal((await ensurePaymentLink(deps, id, 'balance')).reused, false);
});

test('rule 56: only such a payment can be settled; a second settle changes nothing', async () => {
  const { db, links, id, link } = await setup();
  const other = addLink(links, db, id, { type: 'balance' });
  const deps = { database: db, paymentLinksModel: links, bookPaid: async () => {} };
  await assert.rejects(settleWithdrawnPayment(other.id, { ...deps, outcome: 'refunded' }), (err) => err.httpStatus === 409 && err.error === 'NOTHING_TO_SETTLE');
  await assert.rejects(settleWithdrawnPayment(link.id, { ...deps, outcome: 'elsewhere' }), (err) => err.httpStatus === 400);
  await assert.rejects(settleWithdrawnPayment(999, { ...deps, outcome: 'refunded' }), (err) => err.httpStatus === 404);
  await settleWithdrawnPayment(link.id, { ...deps, outcome: 'refunded' });
  await assert.rejects(settleWithdrawnPayment(link.id, { ...deps, outcome: 'stay' }), (err) => err.error === 'NOTHING_TO_SETTLE');
});

test('rule 56: the ledger names the payment and offers both ways to settle it; once refunded it says so', async () => {
  const { db, links, id, link } = await setup();
  const ledgerOf = () => buildLedger({ row: { ...db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) }, links: links.listForReservation(id), canRequest: true, today: inDays(0) })
    .rows.find((r) => r.key === 'deposit').detail.link;
  const day = localIsoDate(new Date(link.paidAt));
  const shown = ledgerOf();
  assert.match(shown.label, new RegExp(`^Payé le ${day.slice(8, 10)}/${day.slice(5, 7)}(/\\d{4})? après retrait : à traiter$`));
  assert.equal(shown.resend, undefined);
  assert.deepEqual(shown.settle, {
    linkId: link.id,
    stay: { label: 'Enregistrer sur le séjour', confirmTitle: 'Enregistrer ce paiement sur le séjour ?', confirmMessage: 'Le montant est compté comme perçu.', confirmLabel: 'Enregistrer' },
    refunded: { label: 'Marquer remboursé', confirmTitle: 'Paiement remboursé ?', confirmMessage: 'À confirmer une fois le remboursement fait chez le prestataire.', confirmLabel: 'Remboursé' },
  });
  await settleWithdrawnPayment(link.id, { database: db, paymentLinksModel: links, outcome: 'refunded', bookPaid: async () => {} });
  const after = ledgerOf();
  assert.equal(after.label, 'Lien retiré · paiement remboursé');
  assert.equal(after.settle, undefined);
  assert.deepEqual(after.resend, { type: 'deposit', label: 'Renvoyer la demande' });
});

test('rule 56: « enregistrer sur le séjour » through the real late booking marks the bucket paid and confirms', async () => {
  const { db, links, id, link } = await setup();
  const { bookWithdrawnPaid } = require('../utils/paymentPollRunner');
  const s = spies();
  await settleWithdrawnPayment(link.id, {
    database: db, paymentLinksModel: links, outcome: 'stay',
    bookPaid: (l, pay) => bookWithdrawnPaid({ database: db, devisModel: devisModel.buildModel(db), paymentLinksModel: links, link: l, pay, ...s }),
  });
  assert.equal(links.findById(link.id).status, 'paid');
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(id).depositPaid, 1);
  assert.deepEqual(s.confirmed, [id]);
});
