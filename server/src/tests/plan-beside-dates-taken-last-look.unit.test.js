// specs/payment-link-lifecycle.md rule 63, reading of 2026-11-01 (audit R11 database N1, money R11-M1, plugins M-1).
// Rule 64 made a link withdrawn for taken dates (`cancelled` / `dates-taken`) owe rule 19's last look. Beside an
// installment plan the only payment that can arrive is an échéance: no plan is made or resized while such an acompte /
// solde / séjour link still owes that read, and should its payment land beside a plan anyway, it is never booked on
// the buckets — it is held on the link as a payment to settle, refund only while the plan is there.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, call, addStay, TODAY } = require('./directInstallmentsFixtures');
const { fakeProvider } = require('./paymentLinkLifecycleFixture');
const { runLastLooks, retryPendingCancellations, bookLateWithdrawnPaid } = require('../utils/paymentPollRunner');
const { settleWithdrawnPayment, unsettledWithdrawnRefusal } = require('../utils/withdrawnPayments');
const { buildLedger } = require('../utils/reservationLedger');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const devisModel = require('../models/devisModel');

const MINUTE = 60 * 1000;
const put = (h, body) => call(h.controller.put, { params: { id: h.reservationId }, body });
const LAST_LOOK = 'Ancien lien de paiement en dernière vérification';

// The state rule 64 leaves after the deactivation of a link withdrawn for taken dates: marker cleared, last look owed.
function addDatesTakenLink(h, { type = 'full', amountCents = 100150, lookInMinutes = 30, markerOwed = false } = {}) {
  const row = h.paymentLinksModel.create({
    reservationId: h.reservationId, type, amountCents, provider: 'qonto', providerLinkId: `pl_taken_${type}_${amountCents}`,
    url: 'https://pay.example.test/taken', status: 'open',
  });
  h.db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'dates-taken', remoteCancelPendingAt = ?, lastLookAt = ? WHERE id = ?")
    .run(markerOwed ? new Date().toISOString() : null, markerOwed ? null : new Date(Date.now() + lookInMinutes * MINUTE).toISOString(), row.id);
  return h.paymentLinksModel.findById(row.id);
}

function effect() {
  const notified = [];
  const confirmed = [];
  return {
    notified,
    confirmed,
    deps: {
      devisModel,
      emitPluginEvent: () => {},
      checkConflict: () => false,
      sendConfirmation: async (id) => { confirmed.push(id); },
      notifyPaidAfterCancel: async (link, options) => { notified.push(options || {}); },
    },
  };
}

const stayFlags = (h) => h.db.prepare('SELECT depositPaid, balancePaid FROM reservations WHERE id = ?').get(h.reservationId);
const raw = (h, id) => h.db.prepare('SELECT * FROM payment_links WHERE id = ?').get(Number(id));
const planState = (h) => h.installmentsModel.listFor(h.reservationId).map((i) => Number(i.paid));

test('rule 63 (R11): a dates-taken acompte / solde / séjour link owing its last look is not known dead — no plan', async () => {
  for (const type of ['deposit', 'balance', 'full']) {
    const h = createHarness();
    addDatesTakenLink(h, { type });
    assert.equal(h.paymentLinksModel.liveLinkReasonForStay(h.reservationId, ['deposit', 'balance', 'full']), 'lastLook');
    const card = h.controller.planFor(h.reservationId);
    assert.equal(card.canCreate, false);
    assert.equal(card.reason, `${LAST_LOOK} : échéancier non créé.`);
    const r = await put(h, { count: 3 });
    assert.equal(r.status, 409, type);
    assert.equal(r.body.error, 'LINK_LAST_LOOK_PENDING');
    assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
  }
});

test('rule 63 (R11): a plan is not resized while such a link owes its read, nor while that read finds the payment in flight', async () => {
  const h = createHarness();
  assert.equal((await put(h, { count: 3 })).status, 200);
  const link = addDatesTakenLink(h, { lookInMinutes: -1 });
  const r = await put(h, { count: 2 });
  assert.equal(r.status, 409);
  assert.equal(r.body.message, `${LAST_LOOK} : échéancier inchangé.`);
  // The look re-arms on a payment in flight (rule 64): still owed, still refused.
  const { deps } = effect();
  const provider = fakeProvider({ paid: false, pending: true });
  await runLastLooks({ ...deps, database: h.db, paymentLinksModel: h.paymentLinksModel, provider, now: new Date() });
  assert.ok(raw(h, link.id).lastLookAt);
  assert.equal((await put(h, { count: 2 })).status, 409);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 3);
});

test('rule 63 (R11): once the last look read the link unpaid, the plan is made', async () => {
  const h = createHarness();
  const link = addDatesTakenLink(h, { lookInMinutes: -1 });
  const { deps } = effect();
  await runLastLooks({ ...deps, database: h.db, paymentLinksModel: h.paymentLinksModel, provider: fakeProvider({ paid: false }), now: new Date() });
  const row = raw(h, link.id);
  assert.equal(row.lastLookAt, null);
  assert.ok(row.unpaidReadAt);
  assert.equal((await put(h, { count: 3 })).status, 200);
});

// Defence in depth: should the payment land beside a plan anyway (a plan made before this release, a race).
// An unpaid devis on the stay's nights, its acompte link open: the held payment makes the stay hold them (rule 32).
async function paidBesidePlan({ path = 'last-look' } = {}) {
  const h = createHarness();
  assert.equal((await put(h, { count: 3 })).status, 200);
  const link = addDatesTakenLink(h, { lookInMinutes: -1, markerOwed: path === 'retry' });
  const devisId = addStay(h.db, { kind: 'devis', devisNumber: 'D-T-916', startDate: '2027-06-15', endDate: '2027-06-18' });
  const devisLink = h.paymentLinksModel.create({
    reservationId: devisId, type: 'full', amountCents: 50000, provider: 'qonto', providerLinkId: 'pl_devis_916', url: 'https://pay.example.test/devis', status: 'open',
  });
  h.devisLinkId = devisLink.id;
  const { deps, notified, confirmed } = effect();
  const provider = fakeProvider({ paid: true });
  const run = path === 'retry' ? retryPendingCancellations : runLastLooks;
  const out = await run({ ...deps, database: h.db, paymentLinksModel: h.paymentLinksModel, provider, now: new Date() });
  return { h, link, out, notified, confirmed };
}

for (const path of ['last-look', 'retry']) {
  test(`rule 63 (R11): a dates-taken bucket payment found by the ${path} beside a plan is never booked on the buckets`, async () => {
    const { h, link, out, notified, confirmed } = await paidBesidePlan({ path });
    const result = out.results.find((r) => r.id === link.id);
    assert.equal(result.effect, 'installment-plan-in-place');
    assert.equal(result.status, 'paid-after-cancel');
    const row = raw(h, link.id);
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancelReason, 'dates-taken');
    assert.ok(row.paidAt);
    assert.equal(row.providerPaymentId, 'pay_pl_taken_full_100150');
    assert.equal(row.lastLookAt, null);
    assert.equal(row.remoteCancelPendingAt, null);
    assert.deepEqual(stayFlags(h), { depositPaid: 0, balancePaid: 0 });
    assert.deepEqual(planState(h), [0, 0, 0]);
    assert.deepEqual(confirmed, []);
    assert.equal(notified.length, 1);
    assert.equal(notified[0].installmentPlan, true);
    // Rule 56: no new request of the stay leaves until it is settled.
    assert.equal(unsettledWithdrawnRefusal(h.db, h.reservationId).error, 'UNSETTLED_WITHDRAWN_PAYMENT');
    // Rule 32 (review of #916, 3): the held payment is the stay's money, the devis on its nights loses its link now.
    const devisLink = raw(h, h.devisLinkId);
    assert.equal(devisLink.status, 'cancelled');
    assert.equal(devisLink.cancelReason, 'dates-taken');
    assert.equal(Number(devisLink.takenByReservationId), h.reservationId);
  });
}

test('rule 63 (R11): a second read of that payment holds nothing twice and alerts once', async () => {
  const { h, link, notified } = await paidBesidePlan();
  h.db.prepare('UPDATE payment_links SET lastLookAt = ? WHERE id = ?').run(new Date(Date.now() - MINUTE).toISOString(), link.id);
  const { deps } = effect();
  const out = await runLastLooks({ ...deps, notifyPaidAfterCancel: async (l, o) => notified.push(o), database: h.db, paymentLinksModel: h.paymentLinksModel, provider: fakeProvider({ paid: true }), now: new Date() });
  assert.equal(out.results[0].effect, 'already-processed');
  assert.equal(notified.length, 1);
  assert.deepEqual(stayFlags(h), { depositPaid: 0, balancePaid: 0 });
});

// The « à traiter » actions of a link, wherever the ledger shows it (its bucket's row once there is no plan).
function findSettle(node, linkId) {
  if (!node || typeof node !== 'object') return null;
  if (node.settle && Number(node.settle.linkId) === Number(linkId)) return node.settle;
  for (const value of Object.values(node)) {
    const hit = findSettle(value, linkId);
    if (hit) return hit;
  }
  return null;
}

const plan = {
  installments: [
    { number: 1, amount: 333.83, status: 'toRequest', dueDate: addDaysToIsoDate(TODAY, 9), statusLabel: 'À demander' },
    { number: 2, amount: 333.83, status: 'upcoming', dueDate: addDaysToIsoDate(TODAY, 100), statusLabel: 'À venir' },
    { number: 3, amount: 333.84, status: 'upcoming', dueDate: addDaysToIsoDate(TODAY, 200), statusLabel: 'À venir' },
  ],
  gap: 0,
};

test('rule 63 (R11): the held payment shows on its own ledger row, refund only; « Enregistrer sur le séjour » is refused', async () => {
  const { h, link } = await paidBesidePlan();
  const { rows } = buildLedger({
    row: h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId),
    links: h.paymentLinksModel.listForStay(h.reservationId), installmentPlan: plan, canRequest: true, today: TODAY,
  });
  const row = rows.find((r) => r.key === 'withdrawnPayments');
  assert.equal(row.label, 'Paiement après retrait');
  assert.equal(row.detail.link.settle.linkId, link.id);
  assert.deepEqual(Object.keys(row.detail.link.settle), ['linkId', 'refunded']);
  assert.match(row.detail.link.label, /payés le .* après retrait : à traiter$/);
  await assert.rejects(
    settleWithdrawnPayment(link.id, { database: h.db, paymentLinksModel: h.paymentLinksModel, outcome: 'stay', bookPaid: async () => { throw new Error('must not book'); } }),
    (err) => err.error === 'INSTALLMENT_PLAN_IN_PLACE',
  );
  await settleWithdrawnPayment(link.id, { database: h.db, paymentLinksModel: h.paymentLinksModel, outcome: 'refunded', bookPaid: async () => {} });
  assert.equal(h.paymentLinksModel.findById(link.id).cancelReason, 'refunded');
  assert.equal(unsettledWithdrawnRefusal(h.db, h.reservationId), null);
});

test('rule 63 (R11): once the plan is deleted, « Enregistrer sur le séjour » books it as rule 33 does — no confirmation', async () => {
  const { h, link } = await paidBesidePlan();
  const removal = await call(h.controller.remove, { params: { id: h.reservationId } });
  assert.equal(removal.status, 200);
  assert.equal(h.installmentsModel.listFor(h.reservationId).length, 0);
  const { rows } = buildLedger({
    row: h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId),
    links: h.paymentLinksModel.listForStay(h.reservationId), installmentPlan: null, canRequest: true, today: TODAY,
  });
  const settle = findSettle(rows, link.id);
  // Review of #916 (2): the confirm says why the guest is not confirmed, not that the nights are taken today.
  assert.equal(settle.stay.confirmMessage, 'Le montant est compté comme perçu, sans confirmation au client (lien retiré : dates prises).');
  const { deps, confirmed, notified } = effect();
  await settleWithdrawnPayment(link.id, {
    database: h.db, paymentLinksModel: h.paymentLinksModel, outcome: 'stay',
    bookPaid: (l, payment) => bookLateWithdrawnPaid({ ...deps, database: h.db, paymentLinksModel: h.paymentLinksModel, link: l, pay: payment }),
  });
  assert.equal(h.paymentLinksModel.findById(link.id).status, 'paid');
  assert.equal(stayFlags(h).balancePaid, 1);
  assert.deepEqual(confirmed, []);
  assert.deepEqual(notified, [], 'review of #916 (2): the operator settled it on free nights — no « dates déjà prises » alert');
  assert.equal(h.db.prepare('SELECT bookingConflictAt FROM reservations WHERE id = ?').get(h.reservationId).bookingConflictAt, null);
});
