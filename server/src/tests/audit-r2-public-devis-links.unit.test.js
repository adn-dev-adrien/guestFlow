// Audit R2 (2026-10-28), public surface — specs/public-online-payment.md rule 16 and
// specs/plugins-phase-3a-online-payment.md rule 28: a devis link must follow the stay the devis became.
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

test('specs/public-online-payment.md rule 16 — N1 cancelling a stay abandons the open links of the devis converted into it', () => {
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

test('specs/plugins-phase-3a-online-payment.md rule 28 — N4 cancelIfOpen never overwrites a paid link', () => {
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

// ---- Review of PR #851 and money audit finding A (2026-10-29) ----
const { retireStaleLinksOfConvertedDevis } = require('../utils/staleLinksOfStay');
const notificationService = require('../utils/notificationService');
const publicPayment = require('../controllers/public/publicPaymentController');

test('money A — a devis link paid above what the converted stay owes shows the trop-perçu, and the alert says so', async () => {
  const { liveQuote } = require('./ledgerFixture');
  const stayId = createStay({ depositDisabled: 1 });
  const owed = fullCents(stayId);
  const { link } = convertedDevis(stayId, { amountCents: owed + 1035 });
  const { out } = await pay(link);
  assert.deepEqual(out.amountMismatch, { expectedCents: owed, receivedCents: owed + 1035 });
  assert.equal((await liveQuote(stayId)).overpaymentTtc, 10.35);
  const { buildPaidAfterCancelEmail } = notificationService.__test;
  const mail = buildPaidAfterCancelEmail({ id: 1, devisNumber: 'D-1' }, { amountCents: owed + 1035 }, '', { amountMismatch: out.amountMismatch });
  assert.match(mail.text, /Trop-perçu de 10,35.€ à rembourser\./);
  assert.equal(rowOf(stayId).balanceAmount, (owed + 1035) / 100, 'the solde records what was received, for the stored trop-perçu measure');
  assert.doesNotMatch(mail.text, /est à percevoir/);
});

test('money A — a link equal to the devis but above the re-priced stay is not booked as a plain payment', async () => {
  const stayId = createStay({ depositDisabled: 1 });
  const owed = fullCents(stayId);
  const { link } = convertedDevis(stayId, { amountCents: owed + 1999 });
  const { out, calls } = await pay(link);
  assert.ok(out.amountMismatch);
  assert.equal(calls.filter((c) => c[0] === 'alert').length, 1);
});

test('money A — retireForAmountChange on a stay also retires its devis links; a conversion retires the stale ones', () => {
  const stayId = createStay();
  const { link } = convertedDevis(stayId, { amountCents: 1234 });
  const [retired] = links.retireForAmountChange(stayId, 'full', fullCents(stayId));
  assert.equal(retired.id, link.id);
  assert.equal(links.findById(link.id).cancelReason, 'amount-changed');

  const other = createStay();
  const stay = rowOf(other);
  const devisId = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice,
      depositAmount, balanceAmount, devisStatus) VALUES ('devis', ?, 1, ?, ?, 2, ?, ?, ?, 'draft')`)
    .run(stay.propertyId, '2029-01-10', '2029-01-13', stay.finalPrice, stay.depositAmount, stay.balanceAmount).lastInsertRowid);
  const stale = links.create({ reservationId: devisId, type: 'full', amountCents: 1234, providerLinkId: 'CV', url: 'u', status: 'open' });
  const conv = dm.convertToReservation(devisId, { allowConflict: true });
  assert.ok(conv.ok, JSON.stringify(conv));
  assert.equal(links.findById(stale.id).status, 'cancelled');
  assert.ok(links.findById(stale.id).remoteCancelPendingAt);
});

test('money A — the boot migration retires stale links of converted devis, never a paid one, and is idempotent', () => {
  const a = createStay();
  const stale = convertedDevis(a, { amountCents: 777 }).link;
  const b = createStay();
  const paid = convertedDevis(b, { amountCents: 778 }).link;
  links.markPaid(paid.id, { providerPaymentId: 'p' });
  const c = createStay();
  const fine = convertedDevis(c, { amountCents: fullCents(c) }).link;
  const retired = retireStaleLinksOfConvertedDevis(db);
  assert.ok(retired.some((l) => l.id === stale.id));
  assert.equal(links.findById(stale.id).status, 'cancelled');
  assert.ok(links.findById(stale.id).remoteCancelPendingAt);
  assert.equal(links.findById(paid.id).status, 'paid');
  assert.equal(links.findById(fine.id).status, 'open');
  assert.equal(retireStaleLinksOfConvertedDevis(db).length, 0);
});

test('R1 — the retry of a retired link on an already converted devis alerts with what was booked and what is left', async () => {
  const stayId = createStay({ depositDisabled: 1 });
  const owed = fullCents(stayId);
  const { link } = convertedDevis(stayId, { amountCents: owed - 5000 });
  const [retired] = links.retireForAmountChange(link.reservationId, 'full', owed);
  assert.equal(retired.id, link.id);
  const alerts = [];
  const provider = { id: 'qonto', getPayment: async () => ({ paid: true, paymentId: 'pr1', paidAt: '2027-04-01T10:00:00Z' }), cancelLink: async () => {} };
  await retryPendingCancellations({
    paymentLinksModel: links, provider, database: db, devisModel: dm, emitPluginEvent: () => {},
    notifyPaidAfterCancel: async (l, o) => alerts.push([l.id, o]),
  });
  assert.deepEqual(alerts.find(([id]) => id === link.id)[1].amountMismatch, { expectedCents: owed, receivedCents: owed - 5000 });
});

test('R2 — acompte paid, then the full link: the surplus is the solde, only the acompte part is refunded', async () => {
  const stayId = createStay();
  const stay = rowOf(stayId);
  const depositCents = Math.round(stay.depositAmount * 100);
  const { devisId, link: full } = convertedDevis(stayId, { amountCents: fullCents(stayId) });
  const deposit = links.create({ reservationId: devisId, type: 'deposit', amountCents: depositCents, providerLinkId: 'D2', url: 'u', status: 'open' });
  await pay(deposit);
  const { out, calls } = await pay(full);
  assert.equal(out.effect, 'double-payment');
  assert.equal(rowOf(stayId).balancePaid, 1, 'the solde is recorded');
  assert.deepEqual(calls.map((c) => c[0]), ['alert']);
  assert.deepEqual(calls[0][1], { doublePaid: true, duplicateCents: depositCents });
  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND changedFields LIKE '%refundOwed%'").all(stayId);
  assert.match(history.map((h) => h.changedFields).join(''), new RegExp(String(stay.depositAmount).replace('.', ',').slice(0, 2)));
});

test('R2 — retireSettled retires an open full link once the acompte is paid', () => {
  const stayId = createStay();
  const { link } = convertedDevis(stayId, { amountCents: fullCents(stayId) });
  db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(stayId);
  assert.ok(links.retireSettled().some((l) => l.id === link.id));
});

test('R2 — minting on a converted devis id reads the paid flags of the converted stay', async () => {
  const stayId = createStay();
  const { devisId } = convertedDevis(stayId);
  db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(stayId);
  const provider = { id: 'qonto', getPayment: async () => ({ paid: false }), cancelLink: async () => {}, createLink: async () => { throw new Error('must not mint'); } };
  await assert.rejects(
    ensurePaymentLink({ database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 5000 }, devisId, 'full'),
    (e) => e.error === 'ALREADY_PAID',
  );
});

test('R3 — a refused or failed mint never retires the other valid link', async () => {
  const stayId = createStay({ depositDisabled: 1 });
  const { devisId, link: full } = convertedDevis(stayId, { amountCents: fullCents(stayId) });
  db.prepare("UPDATE reservations SET convertedReservationId = NULL, depositAmount = 0 WHERE id = ?").run(devisId);
  const provider = { id: 'qonto', getPayment: async () => ({ paid: false }), cancelLink: async () => {}, createLink: async () => { throw new Error('down'); } };
  await assert.rejects(ensurePaymentLink({ database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 0 }, devisId, 'deposit'), (e) => e.error === 'ZERO_AMOUNT');
  assert.equal(links.findById(full.id).status, 'open');
  await assert.rejects(ensurePaymentLink({ database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 9000 }, devisId, 'deposit'), /down/);
  assert.equal(links.findById(full.id).status, 'open');
});

test('R4 — the public status of a devis whose converted stay was cancelled answers cancelled', async () => {
  const stayId = createStay();
  const { devisId } = convertedDevis(stayId);
  db.prepare("UPDATE reservations SET requestOrigin = 'public', publicToken = 'tok' WHERE id = ?").run(devisId);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stayId);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await publicPayment.status({ params: { id: String(devisId) }, query: { token: 'tok' }, headers: {} }, res);
  assert.equal(res.body.status || (res.body.data && res.body.data.status), 'cancelled');
});

// Review of PR #851, S1 — the full link retired as settled once the acompte is paid, then paid anyway.
for (const kind of ['devis', 'reservation']) {
  test(`S1 — ${kind}: a full link retired as settled by the acompte and paid anyway is refund-flagged for the acompte part`, async () => {
    const stayId = createStay();
    const stay = rowOf(stayId);
    const depositCents = Math.round(stay.depositAmount * 100);
    const ownerId = kind === 'devis' ? convertedDevis(stayId).devisId : stayId;
    const deposit = links.create({ reservationId: ownerId, type: 'deposit', amountCents: depositCents, providerLinkId: `SD${kind}`, url: 'u', status: 'open' });
    const full = links.create({ reservationId: ownerId, type: 'full', amountCents: fullCents(stayId), providerLinkId: `SF${kind}`, url: 'u', status: 'open' });
    await pay(deposit);
    assert.ok(links.retireSettled().some((l) => l.id === full.id && l.cancelReason === 'settled'));
    const alerts = [];
    const provider = { id: 'qonto', getPayment: async (pid) => (pid === `SF${kind}` ? { paid: true, paymentId: 'pS', paidAt: '2027-04-02T10:00:00Z' } : { paid: false }), cancelLink: async () => {} };
    await retryPendingCancellations({
      paymentLinksModel: links, provider, database: db, devisModel: dm, emitPluginEvent: () => {},
      notifyPaidAfterCancel: async (l, o) => alerts.push([l.id, o]),
    });
    assert.deepEqual(alerts.find(([id]) => id === full.id)[1], { doublePaid: true, duplicateCents: depositCents });
    assert.equal(rowOf(stayId).balancePaid, 1);
    const refund = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND changedFields LIKE '%refundOwed%'").all(stayId);
    assert.ok(refund.length >= 1, 'a « Remboursement à faire » row is kept');
  });
}

test('S3 — the partial double-payment alert asks to refund « cette part »', () => {
  const { buildPaidAfterCancelEmail } = notificationService.__test;
  const mail = buildPaidAfterCancelEmail({ id: 1 }, { amountCents: 45536 }, '', { doublePaid: true, duplicateCents: 10000 });
  assert.match(mail.text, /rembourser cette part/);
  assert.match(mail.subject, /100,00/);
});

// Review of PR #851, T1 — two links of the same type on one devis, the second retired as settled then paid.
for (const type of ['full', 'deposit']) {
  test(`T1 — two ${type} links: the second, retired as settled and paid anyway, is a refund-flagged double payment`, async () => {
    const stayId = createStay();
    const cents = type === 'full' ? fullCents(stayId) : Math.round(rowOf(stayId).depositAmount * 100);
    const { devisId, link: first } = convertedDevis(stayId, { type, amountCents: cents });
    const second = links.create({ reservationId: devisId, type, amountCents: cents, providerLinkId: `T1${type}`, url: 'u', status: 'open' });
    await pay(first);
    assert.ok(links.retireSettled().some((l) => l.id === second.id && l.cancelReason === 'settled'));
    const alerts = [];
    const provider = { id: 'qonto', getPayment: async (pid) => (pid === `T1${type}` ? { paid: true, paymentId: 'pT', paidAt: '2027-04-01T15:00:00Z' } : { paid: false }), cancelLink: async () => {} };
    const out = await retryPendingCancellations({
      paymentLinksModel: links, provider, database: db, devisModel: dm, emitPluginEvent: () => {},
      notifyPaidAfterCancel: async (l, o) => alerts.push([l.id, o]),
    });
    assert.equal(out.results.find((r) => r.id === second.id).status, 'paid-after-cancel');
    assert.deepEqual(alerts.find(([id]) => id === second.id)[1], { doublePaid: true });
    const refund = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND changedFields LIKE '%refundOwed%'").all(stayId);
    assert.ok(refund.length >= 1);
  });
}
