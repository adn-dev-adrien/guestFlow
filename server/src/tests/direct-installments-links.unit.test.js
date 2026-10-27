// specs/direct-installments.md rules 15-17 — one payment link per installment, at its exact amount; a paid
// link marks its installment; a link that bills an old amount is retired AND deactivated at the provider.
const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureInstallmentLink, sendInstallmentRequest } = require('../utils/paymentRequestService');
const { processPaidLink, retryPendingCancellations, applyPaidEffect } = require('../utils/paymentPollRunner');
const { recordInstallmentPayment } = require('../utils/installmentPayment');
const { createHarness, call, TODAY } = require('./directInstallmentsFixtures');

function fakeProvider() {
  const calls = { created: [], cancelled: [] };
  let n = 0;
  return {
    calls,
    id: 'qonto',
    async createLink(args) { n += 1; calls.created.push(args); return { id: `ql_${n}`, url: `https://pay.example/${n}`, status: 'open' }; },
    async getPayment() { return { paid: false }; },
    async getLinkStatus() { return 'open'; },
    async cancelLink(id) { calls.cancelled.push(id); },
  };
}

async function withPlan() {
  const h = createHarness();
  await call(h.controller.put, { params: { id: h.reservationId }, body: { count: 3 } });
  const provider = fakeProvider();
  const deps = {
    database: h.db, paymentLinksModel: h.paymentLinksModel, installmentsModel: h.installmentsModel, provider,
    deactivateLinks: async (links) => h.state.deactivated.push(...links),
  };
  return { ...h, provider, deps, rows: h.installmentsModel.listFor(h.reservationId) };
}

test('rule 17 — a link is minted per installment at its exact amount, typed installment', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[2].id);
  assert.equal(link.amountCents, 33350);
  assert.equal(link.reused, false);
  assert.equal(h.provider.calls.created[0].amountCents, 33350);
  const stored = h.paymentLinksModel.findOpenForInstallment(h.rows[2].id);
  assert.deepEqual([stored.type, stored.installmentId, stored.reservationId], ['installment', h.rows[2].id, h.reservationId]);
  assert.match(h.provider.calls.created[0].title, /Séjour|Échéance/, 'named like the other stay lines');
});

test('rule 17 — the open link of an installment is reused while it bills the current amount', async () => {
  const h = await withPlan();
  const first = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id);
  const again = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id);
  assert.equal(again.reused, true);
  assert.equal(again.url, first.url);
  assert.equal(h.provider.calls.created.length, 1);
  const other = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  assert.notEqual(other.url, first.url, 'one link per installment, never shared');
});

test('rule 17 — an amount that changed retires the old link and deactivates it at the provider before a new one is minted', async () => {
  const h = await withPlan();
  const old = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  h.installmentsModel.updateRow(h.rows[1].id, { amountCents: 40000 });
  const fresh = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  assert.equal(fresh.amountCents, 40000);
  assert.notEqual(fresh.url, old.url);
  assert.equal(h.paymentLinksModel.findById(old.id).status, 'cancelled');
  assert.deepEqual(h.state.deactivated.map((l) => l.id), [old.id], 'the old URL can no longer be paid');
});

test('rule 17 — retireChangedLinks (after a save) abandons only the links that bill a stale amount', async () => {
  const h = await withPlan();
  const kept = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id);
  const stale = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  h.installmentsModel.updateRow(h.rows[1].id, { amountCents: 12345 });
  const pending = h.controller.retireChangedLinks(h.reservationId);
  await pending;
  assert.equal(h.paymentLinksModel.findById(kept.id).status, 'open');
  const retired = h.paymentLinksModel.findById(stale.id);
  assert.deepEqual([retired.status, retired.cancelReason], ['cancelled', 'amount-changed']);
  assert.ok(retired.remoteCancelPendingAt, 'the poll retries the deactivation should the provider be down');
  assert.deepEqual(h.state.deactivated.map((l) => l.id), [stale.id]);
  assert.equal(h.controller.retireChangedLinks(h.reservationId), null, 'nothing left to do: no promise to wait for');
});

test('rule 17 — a link already paid is never replaced: the new link is refused', async () => {
  const h = await withPlan();
  await ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id);
  h.installmentsModel.updateRow(h.rows[1].id, { amountCents: 40000 });
  h.provider.getPayment = async () => ({ paid: true });
  await assert.rejects(ensureInstallmentLink(h.deps, h.reservationId, h.rows[1].id), (err) => err.error === 'LINK_ALREADY_PAID');
});

test('rule 17 — a paid installment, or one of another stay, gets no link', async () => {
  const h = await withPlan();
  h.installmentsModel.markPaid(h.rows[0].id, { paidDate: TODAY, method: 'cash' });
  await assert.rejects(ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id), (err) => err.error === 'INSTALLMENT_PAID');
  await assert.rejects(ensureInstallmentLink(h.deps, h.reservationId + 1, h.rows[1].id), (err) => err.error === 'INSTALLMENT_NOT_FOUND');
});

test('rule 20 — « Envoyer la demande » mints the link, sends the template with it and marks the installment requested', async () => {
  const h = await withPlan();
  const sent = [];
  const deps = { ...h.deps, sendTemplate: async (payload) => { sent.push(payload); return { sent: true, emailLogId: 7, recipientEmail: 'camille@example.com' }; } };
  const { httpStatus, body } = await sendInstallmentRequest(deps, h.reservationId, h.rows[0].id);
  assert.equal(httpStatus, 200);
  assert.equal(body.type, 'installment');
  assert.equal(sent[0].stableKey, 'installment_request');
  assert.equal(sent[0].paymentLink, body.url);
  assert.equal(sent[0].installment.id, h.rows[0].id);
  assert.ok(h.installmentsModel.findById(h.rows[0].id).requestedAt);
  assert.equal(h.controller.planFor(h.reservationId).installments[0].linkUrl, body.url);
  assert.equal(h.controller.planFor(h.reservationId).installments[0].status, 'requested');

  const failing = await sendInstallmentRequest({ ...deps, sendTemplate: async () => ({ sent: false, reason: 'no-email' }) }, h.reservationId, h.rows[1].id);
  assert.equal(failing.httpStatus, 400);
  assert.equal(h.installmentsModel.findById(h.rows[1].id).requestedAt, null, 'a request that did not leave is not a request');
});

test('rule 15 — a paid link marks its installment paid at the day the guest paid, and replaying it records nothing twice', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id);
  const pay = { paid: true, paymentId: 'pay_1', paidAt: '2026-10-28T09:30:00Z' };
  const first = await processPaidLink({ database: h.db, devisModel: {}, paymentLinksModel: h.paymentLinksModel, link: h.paymentLinksModel.findById(link.id), paidPayment: pay });
  assert.equal(first.effect, 'installment-marked');
  const installment = h.installmentsModel.findById(h.rows[0].id);
  assert.deepEqual([installment.paid, installment.paidMethod], [1, 'link']);
  assert.equal(h.paymentLinksModel.findById(link.id).status, 'paid');
  const stay = h.db.prepare('SELECT installmentsPaidAmount, installmentsUnpaidAmount FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([stay.installmentsPaidAmount, stay.installmentsUnpaidAmount], [334, 667.5]);

  const replay = await processPaidLink({ database: h.db, devisModel: {}, paymentLinksModel: h.paymentLinksModel, link: h.paymentLinksModel.findById(link.id), paidPayment: pay });
  assert.equal(replay.effect, 'already-processed');
});

test('rule 15 — recording an installment announces reservation.paid once and retires its open link', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id);
  const events = [];
  const emit = (...args) => events.push(args);
  const done = recordInstallmentPayment({ db: h.db, emit }, { installmentId: h.rows[0].id, paidDate: TODAY, method: 'transfer' });
  assert.equal(done.flipped, true);
  const again = recordInstallmentPayment({ db: h.db, emit }, { installmentId: h.rows[0].id, paidDate: '2026-11-01', method: 'cash' });
  assert.equal(again.flipped, false);
  assert.deepEqual(events, [['reservation.paid', { reservationId: h.reservationId, bucket: 'installment' }]]);
  assert.equal(h.installmentsModel.findById(h.rows[0].id).paidDate, TODAY, 'never re-dated');
  const retired = h.paymentLinksModel.findById(link.id);
  assert.deepEqual([retired.status, retired.cancelReason], ['cancelled', 'settled'], 'paid another way: the link is abandoned');
});

test('rule 15 — a paid link on a cancelled stay is money to refund, never a paid installment', async () => {
  const h = await withPlan();
  const link = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id);
  h.db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(h.reservationId);
  const effect = applyPaidEffect({ database: h.db, devisModel: {}, link: h.paymentLinksModel.findById(link.id) });
  assert.equal(effect.effect, 'reservation-cancelled');
  assert.equal(h.installmentsModel.findById(h.rows[0].id).paid, 0);
});

test('rule 17 — a link retired for an amount change and paid anyway books the installment at what was paid', async () => {
  const h = await withPlan();
  const old = await ensureInstallmentLink(h.deps, h.reservationId, h.rows[0].id);
  h.installmentsModel.updateRow(h.rows[0].id, { amountCents: 40000 });
  await h.controller.retireChangedLinks(h.reservationId);
  const provider = {
    ...h.provider,
    async getPayment() { return { paid: true, paymentId: 'pay_old', paidAt: '2026-10-29T10:00:00Z' }; },
  };
  const result = await retryPendingCancellations({
    paymentLinksModel: h.paymentLinksModel, provider, database: h.db, devisModel: {}, notifyPaidAfterCancel: async () => {},
  });
  assert.equal(result.results[0].status, 'paid');
  const installment = h.installmentsModel.findById(h.rows[0].id);
  assert.deepEqual([installment.paid, installment.amountCents], [1, 33400], 'the money received, not the new amount');
  assert.equal(h.paymentLinksModel.findById(old.id).status, 'paid');
});
