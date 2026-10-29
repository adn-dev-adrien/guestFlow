// Audit R2 (2026-10-28), public surface — specs/public-online-payment.md rules 28-32 and
// specs/plugins-phase-3a-online-payment.md rules 25-26: a devis link must follow the stay the devis became.
// N1 cancellation, N2 re-price, N3 acompte + full both paid, N4 a payment is never overwritten by a
// cancellation, unreadable provider keeps the link; A allowConflict on a retired link paid anyway.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createStay, rowOf, save } = require('./ledgerFixture');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const reservationsModelFactory = require('../models/reservationsModel');
const refundsModelFactory = require('../models/refundsModel');
const compensationsModelFactory = require('../models/cancellationCompensationsModel');
const { cancelReservation } = require('../utils/cancelReservation');
const { processPaidLink, retryPendingCancellations } = require('../utils/paymentPollRunner');
const { ensurePaymentLink } = require('../utils/paymentRequestService');
const { settleRetiredDevisLinks } = require('../utils/retiredDevisLinks');

const links = paymentLinksModel.buildModel(db);
const dm = devisModel.buildModel(db);

// A devis converted into `stayId`, with its own payment link (the link keeps the devis id).
function convertedDevis(stayId, { type = 'full', amountCents = 100 } = {}) {
  const stay = rowOf(stayId);
  const devisId = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice,
      depositAmount, balanceAmount, convertedReservationId) VALUES ('devis', ?, 1, ?, ?, 2, ?, ?, ?, ?)`)
    .run(stay.propertyId, stay.startDate, stay.endDate, stay.finalPrice, stay.depositAmount, stay.balanceAmount, stayId).lastInsertRowid);
  const link = links.create({ reservationId: devisId, type, amountCents, providerLinkId: `P${devisId}${type}`, url: 'u', status: 'open' });
  return { devisId, link };
}
const fullCents = (stayId) => { const r = rowOf(stayId); return Math.round((r.depositAmount + r.balanceAmount) * 100); };

async function pay(link, extra = {}) {
  const calls = [];
  const out = await processPaidLink({
    database: db, devisModel: dm, paymentLinksModel: links, link: links.findById(link.id),
    paidPayment: { paid: true, paymentId: `pay${link.id}`, paidAt: '2027-04-01T10:00:00Z' },
    sendConfirmation: async (r) => calls.push(['confirm', r]),
    notifyPaidAfterCancel: async (l, o) => calls.push(['alert', o || {}]),
    notifyConflict: async (r) => calls.push(['conflict', r]),
    emitPluginEvent: () => {}, ...extra,
  });
  return { out, calls };
}

test('N1 — cancelling a stay abandons the open links of the devis converted into it', () => {
  const stayId = createStay();
  const { link } = convertedDevis(stayId, { amountCents: fullCents(stayId) });
  const deps = {
    database: db, reservationsModel: reservationsModelFactory.create(db), refundsModel: refundsModelFactory.createModel(db),
    compensationsModel: compensationsModelFactory.buildModel(db), paymentLinksModel: links,
  };
  const res = cancelReservation(deps, stayId, { today: '2027-01-01', vatRate: 10, reason: 'Test' });
  assert.equal(res.ok, true);
  assert.equal(links.findById(link.id).status, 'cancelled');
});

test('N1 — a devis link paid after its converted stay was cancelled is money to refund, never a paid stay', async () => {
  const stayId = createStay();
  const { link } = convertedDevis(stayId, { amountCents: fullCents(stayId) });
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stayId);
  const before = rowOf(stayId);
  const { out, calls } = await pay(link);
  assert.equal(out.effect, 'reservation-cancelled');
  assert.deepEqual(calls.map((c) => c[0]), ['alert']);
  const after = rowOf(stayId);
  assert.deepEqual([after.depositPaid, after.balancePaid], [before.depositPaid, before.balancePaid]);
});

test('N2 — a devis link paid after the converted stay was re-priced is booked at what was received, with an alert', async () => {
  const stayId = createStay();
  const received = fullCents(stayId);
  const { link } = convertedDevis(stayId, { amountCents: received });
  db.prepare('UPDATE reservations SET balanceAmount = balanceAmount + 50 WHERE id = ?').run(stayId);
  const { out, calls } = await pay(link);
  assert.equal(out.status, 'paid');
  assert.deepEqual(out.amountMismatch, { expectedCents: received + 5000, receivedCents: received });
  assert.equal(calls.filter((c) => c[0] === 'alert').length, 1);
  assert.ok(rowOf(stayId).complementAmount > 0, 'the shortfall is owed, not hidden');
});

test('N2 — saving the fiche retires the stale link of the devis converted into the stay', async () => {
  const stayId = createStay();
  const { link } = convertedDevis(stayId, { amountCents: fullCents(stayId) });
  const res = await save(stayId, { adults: 4 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const retired = links.findById(link.id);
  assert.equal(retired.status, 'cancelled');
  assert.equal(retired.cancelReason, 'amount-changed');
});

test('N3 — an acompte link and a full link of one devis both paid: the second is a double payment', async () => {
  const stayId = createStay();
  const { devisId, link: full } = convertedDevis(stayId, { amountCents: fullCents(stayId) });
  const deposit = links.create({ reservationId: devisId, type: 'deposit', amountCents: Math.round(rowOf(stayId).depositAmount * 100), providerLinkId: 'D', url: 'u', status: 'open' });
  const first = await pay(deposit);
  assert.equal(first.out.effect, 'already-converted');
  const second = await pay(full);
  assert.equal(second.out.effect, 'double-payment');
  assert.equal(second.out.duplicateLink, true);
  assert.deepEqual(second.calls.map((c) => c[0]), ['alert']);
});

test('N3 — minting an acompte link retires the open full link of the same record', async () => {
  const stayId = createStay();
  const { link: full } = convertedDevis(stayId, { amountCents: fullCents(stayId) });
  const devisId = full.reservationId;
  db.prepare("UPDATE reservations SET kind = 'devis', convertedReservationId = NULL WHERE id = ?").run(devisId);
  const provider = { id: 'qonto', getPayment: async () => ({ paid: false }), cancelLink: async () => {}, createLink: async () => ({ id: 'NEW', url: 'u2', status: 'open' }) };
  await ensurePaymentLink({ database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 9000 }, devisId, 'deposit');
  assert.equal(links.findById(full.id).status, 'cancelled');
});

test('N4 — a link paid while it is being replaced stays paid and no new link is minted', async () => {
  const stayId = createStay();
  const { devisId, link: l1 } = convertedDevis(stayId, { amountCents: 40000 });
  db.prepare("UPDATE reservations SET convertedReservationId = NULL WHERE id = ?").run(devisId);
  const provider = {
    id: 'qonto',
    async getPayment() {
      links.markPaid(l1.id, { providerPaymentId: 'pay1' });
      return { paid: false };
    },
    async cancelLink() {},
    async createLink() { throw new Error('must not mint'); },
  };
  await assert.rejects(
    ensurePaymentLink({ database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 45536 }, devisId, 'full'),
    (e) => e.error === 'LINK_ALREADY_PAID',
  );
  assert.equal(links.findById(l1.id).status, 'paid');
});

test('N4 — cancelIfOpen never overwrites a paid link', () => {
  const stayId = createStay();
  const { link } = convertedDevis(stayId);
  links.markPaid(link.id, { providerPaymentId: 'x' });
  assert.equal(links.cancelIfOpen(link.id), null);
  assert.equal(links.findById(link.id).status, 'paid');
});

test('provider error — a retired devis link whose payment status is unreadable is kept, not deactivated', async () => {
  const stayId = createStay();
  const { link } = convertedDevis(stayId, { amountCents: 123 });
  const [retired] = links.retireForAmountChange(link.reservationId, 'full', 999);
  const cancelled = [];
  const provider = { id: 'qonto', getPayment: async () => { throw new Error('429'); }, cancelLink: async (id) => cancelled.push(id) };
  const out = await settleRetiredDevisLinks([retired], { paymentLinksModel: links, provider, database: db, devisModel: dm });
  assert.deepEqual(cancelled, []);
  assert.equal(out.unreadable, 1);
  assert.ok(links.findById(link.id).remoteCancelPendingAt, 'the marker stays for the retry');
});

test('A — a retired devis link paid after its dates were taken still converts the devis and flags the conflict', async () => {
  const stayId = createStay();
  const stay = rowOf(stayId);
  const devisId = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice,
      depositAmount, balanceAmount, devisStatus) VALUES ('devis', ?, 1, ?, ?, 2, ?, ?, ?, 'draft')`)
    .run(stay.propertyId, stay.startDate, stay.endDate, stay.finalPrice, stay.depositAmount, stay.balanceAmount).lastInsertRowid);
  const link = links.create({ reservationId: devisId, type: 'full', amountCents: 10000, providerLinkId: 'RA', url: 'u', status: 'open' });
  links.retireForAmountChange(devisId, 'full', 99999);
  const provider = { id: 'qonto', getPayment: async () => ({ paid: true, paymentId: 'payA', paidAt: '2027-04-01T10:00:00Z' }), cancelLink: async () => {} };
  await retryPendingCancellations({
    paymentLinksModel: links, provider, database: db, devisModel: dm, notifyPaidAfterCancel: async () => {},
    notifyConflict: async () => {}, checkConflict: () => true, emitPluginEvent: () => {},
  });
  assert.ok(rowOf(devisId).convertedReservationId, 'the guest paid: a stay must exist');
  assert.equal(links.findById(link.id).status, 'paid');
});
