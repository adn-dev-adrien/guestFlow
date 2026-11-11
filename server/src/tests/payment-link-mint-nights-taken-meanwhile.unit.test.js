// specs/payment-link-lifecycle.md rules 11, 55 (review of #907, m1) — the nights can be taken or closed while the
// provider is creating the link (an iCal sync, another devis paid, a closure saved): the mint checks them again
// before storing it, refuses, and the fresh provider link is withdrawn and deactivated (marker kept on failure).

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const { ensurePaymentLink, ensureInstallmentLink } = require('../utils/paymentRequestService');
const paymentLinksModel = require('../models/paymentLinksModel');

let seq = 0;
function provider({ during, failCancel = false }) {
  const calls = [];
  return {
    calls, id: 'qonto', label: 'Qonto', isReady: () => true,
    createLink: async () => {
      seq += 1;
      calls.push(['createLink']);
      await during();
      return { id: `pl_race_${seq}`, url: `https://pay.example.test/race/${seq}`, status: 'open' };
    },
    getPayment: async () => ({ paid: false }),
    getLinkStatus: async () => 'open',
    cancelLink: async (id) => { calls.push(['cancelLink', id]); if (failCancel) throw new Error('down'); },
  };
}
const depsOf = (p) => ({ database: db, paymentLinksModel, provider: p, resolveAmountCents: () => 12000 });

test('rule 11: a stay taking the nights during the provider call refuses the mint; the fresh link is withdrawn and deactivated', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(40), end: inDays(44) });
  const p = provider({ during: async () => { addStay({ propertyId, platform: 'Booking', start: inDays(41), end: inDays(43) }); } });
  await assert.rejects(ensurePaymentLink(depsOf(p), devisId, 'deposit'), (err) => err.httpStatus === 409 && err.error === 'DATES_UNAVAILABLE');
  const [row] = paymentLinksModel.listForReservation(devisId);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.cancelReason, 'dates-taken');
  assert.equal(row.remoteCancelPendingAt, null);
  assert.deepEqual(p.calls.at(-1), ['cancelLink', row.providerLinkId]);
});

test('rule 55: a closure saved during the provider call refuses it too; a failed deactivation keeps the marker', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(50), end: inDays(53) });
  const p = provider({ failCancel: true, during: async () => {
    db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, 'Travaux', ?, ?)").run(propertyId, inDays(51), inDays(52));
  } });
  await assert.rejects(ensurePaymentLink(depsOf(p), devisId, 'full'), (err) => err.error === 'CLOSED_DATES');
  const [row] = paymentLinksModel.listForReservation(devisId);
  assert.equal(row.status, 'cancelled');
  assert.ok(row.remoteCancelPendingAt, 'the poll retries the deactivation');
});

test('rule 11: the échéance link is checked again the same way', async () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: inDays(60), end: inDays(63) });
  const installment = { id: 71, reservationId: stay, number: 1, amountCents: 15000, paid: 0 };
  const installmentsModel = { findById: () => installment, listFor: () => [installment] };
  const p = provider({ during: async () => { addStay({ propertyId, platform: 'Airbnb', start: inDays(61), end: inDays(62) }); } });
  await assert.rejects(ensureInstallmentLink({ ...depsOf(p), installmentsModel }, stay, 71), (err) => err.error === 'DATES_UNAVAILABLE');
  const [row] = paymentLinksModel.listForReservation(stay);
  assert.equal(row.status, 'cancelled');
});

test('rule 11: nothing changed during the call — the link is stored open', async () => {
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(70), end: inDays(73) });
  const out = await ensurePaymentLink(depsOf(provider({ during: async () => {} })), devisId, 'deposit');
  assert.equal(paymentLinksModel.findById(out.id).status, 'open');
});
