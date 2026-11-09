// specs/resource-booking-pricing-and-invoicing.md rules 13-19, 25 and A2 — the Qonto invoice of a booking, through a fake
// issuer: what it is asked, what is frozen, what a refusal keeps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card } = require('./standaloneBookingFixture');
const { createInvoicing } = require('../invoicing');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

function fakeIssuer(over = {}) {
  const calls = [];
  const issuer = {
    id: 'fake', calls,
    isReady: () => true,
    async issue(request) { calls.push(['issue', request]); return { invoiceId: 'inv-1', number: `F-${Y}-0142`, totalCents: request.expectedTotalCents, clientId: 'cli-1', markedPaid: true }; },
    async findCardBatch(date) { calls.push(['find', date]); return null; },
    async attach(args) { calls.push(['attach', args]); return { attachmentId: 'att-1' }; },
    async invoiceStatus() { return 'paid'; },
    ...over,
  };
  return issuer;
}

function setup(over, { now } = {}) {
  const { model, resourceId, db } = seed();
  const issuer = fakeIssuer(over);
  const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, now, logger: { error() {}, warn() {} } });
  return { model, resourceId, db, issuer, invoicing };
}

test('rule 13 — no invoice before a payment, nor on a caisse-interne payment, nor without Qonto', async () => {
  const { model, resourceId, invoicing } = setup();
  const id = book(model, resourceId);
  assert.equal((await invoicing.issue(id)).code, 'NOT_PAID');
  model.recordPayment(id, { tenders: [{ method: 'cash', amountCents: 12000, internal: true }] });
  assert.equal((await invoicing.issue(id)).code, 'INTERNAL_CASH');
  const off = setup({ isReady: () => false });
  const other = book(off.model, off.resourceId);
  off.model.recordPayment(other, { tenders: card(12000) });
  assert.equal((await off.invoicing.issue(other)).code, 'ISSUER_UNAVAILABLE');
});

test('rule 14 — one item per money line, the deductions as one discount, the total guarded, the payment day as issue day', async () => {
  const { model, resourceId, invoicing, issuer } = setup();
  const id = book(model, resourceId, { offeredMinutes: 30, billing: { street: '3 rue des Lilas', postcode: '07000', city: 'Privas' } });
  model.recordPayment(id, { tenders: card(9500), paidAt: `${Y}-11-09` });
  const out = await invoicing.issue(id);
  assert.equal(out.ok, true);
  const [, request] = issuer.calls.find((c) => c[0] === 'issue');
  assert.deepEqual(request.items.map((i) => [i.amountCents, i.vatRate]), [[5000, 20], [7000, 20]]);
  assert.deepEqual(request.discount, { title: 'Temps offert', amountCents: 2500, vatRate: 20 });
  assert.equal(request.expectedTotalCents, 9500);
  assert.equal(request.issueDate, `${Y}-11-09`);
  assert.deepEqual(request.client, { firstName: 'Claire', lastName: 'Martin', clientId: null, street: '3 rue des Lilas', postcode: '07000', city: 'Privas', countryCode: 'FR' });
  assert.equal(request.idempotencyKey, `resource-booking:${id}:invoice:0`);
});

test('rule 15 — an invoiced booking is frozen: only the notes move, delete is refused', async () => {
  const { model, resourceId, invoicing } = setup();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000) });
  await invoicing.issue(id);
  const row = model.findById(id);
  assert.equal(row.frozen, true);
  assert.equal(row.invoice.number, `F-${Y}-0142`);
  assert.equal(model.update(id, { startTime: '17:00' }).code, 'BOOKING_INVOICED');
  assert.equal(model.update(id, { notes: 'Serviette' }).ok, true);
  assert.equal(model.findById(id).notes, 'Serviette');
  assert.equal(model.remove(id).code, 'BOOKING_INVOICED');
  assert.equal(model.clearPayment(id).code, 'BOOKING_INVOICED');
});

test('rule 16 — a failed issue leaves no number and no frozen booking', async () => {
  const { model, resourceId, invoicing } = setup({ async issue() { throw new Error('boom'); } });
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000) });
  const out = await invoicing.issue(id);
  assert.equal(out.code, 'ISSUER_FAILED');
  const row = model.findById(id);
  assert.equal(row.invoice, null);
  assert.equal(row.frozen, false);
  assert.equal(row.paid, true);
});

test('rule 25 — Qonto asks for the address: 422, the payment stays, the booking is not frozen', async () => {
  const err = Object.assign(new Error("Qonto demande l'adresse de facturation pour émettre la facture."), { code: 'ISSUER_NEEDS_ADDRESS' });
  const { model, resourceId, invoicing } = setup({ async issue() { throw err; } });
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000) });
  const out = await invoicing.issue(id);
  assert.equal(out.status, 422);
  assert.equal(out.code, 'QONTO_NEEDS_ADDRESS');
  assert.equal(model.findById(id).paid, true);
  assert.equal(model.findById(id).frozen, false);
});

test('rules 17-19 — a card payment waits for the day\'s batch, then joins it once; 7 days without it fail visibly', async () => {
  let batch = null;
  const day = `${Y}-11-09`;
  let clock = new Date(`${day}T20:00:00Z`);
  const { model, resourceId, invoicing, issuer } = setup({ async findCardBatch() { return batch; } }, { now: () => clock });
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: card(12000), paidAt: day });
  await invoicing.issue(id);
  assert.equal(model.findById(id).invoice.attachment.state, 'pending');
  batch = { transactionId: 'tx-9' };
  await invoicing.watch();
  const att = model.findById(id).invoice.attachment;
  assert.equal(att.state, 'attached');
  await invoicing.attach(id);
  assert.equal(issuer.calls.filter((c) => c[0] === 'attach').length, 1);
  assert.equal(issuer.calls.find((c) => c[0] === 'attach')[1].idempotencyKey, `resource-booking:${id}:attach:tx-9`);

  const other = book(model, resourceId, { startTime: '10:00', endTime: '11:00' });
  model.recordPayment(other, { tenders: card(5000), paidAt: day });
  batch = null;
  await invoicing.issue(other);
  clock = new Date(`${Y}-11-20T08:00:00Z`);
  await invoicing.attach(other);
  assert.equal(model.findById(other).invoice.attachment.state, 'failed');
  assert.equal((await invoicing.attach(other, { transactionId: 'tx-manual' })).ok, true);
  assert.equal(model.findById(other).invoice.attachment.state, 'attached');
});

test('rule 17 — a payment without a card line is never joined to a card batch', async () => {
  const { model, resourceId, invoicing, issuer } = setup();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: [{ method: 'cheque', amountCents: 12000 }] });
  await invoicing.issue(id);
  assert.equal(model.findById(id).invoice.attachment.state, null);
  assert.equal(issuer.calls.some((c) => c[0] === 'find'), false);
});

test('A2 (rule 15) — an invoice cancelled by hand in Qonto frees the booking, and a new one takes a new key', async () => {
  let status = 'paid';
  const { model, resourceId, invoicing, issuer } = setup({ async invoiceStatus() { return status; } });
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: [{ method: 'cheque', amountCents: 12000 }] });
  await invoicing.issue(id);
  status = 'canceled';
  await invoicing.watch();
  const row = model.findById(id);
  assert.equal(row.frozen, false);
  assert.equal(row.invoice.cancelled, true);
  assert.equal(model.update(id, { notes: 'x', startTime: '18:00' }).ok, true);
  await invoicing.issue(id);
  const keys = issuer.calls.filter((c) => c[0] === 'issue').map((c) => c[1].idempotencyKey);
  assert.notEqual(keys[0], keys[1]);
});
