// specs/resource-booking-pricing-and-invoicing.md rule 45 (R35b N1) — a Qonto invoice is made only on an explicit
// choice of the operator: the arrival issues one when its body says `invoice: true`, nothing else does (payment, edit,
// the hourly job), and an `invoice` that is not a boolean is refused before the arrival is written.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, book, card, DAY } = require('./standaloneBookingFixture');
const { createController } = require('../controller');
const { createInvoicing } = require('../invoicing');

const onTheDay = () => new Date(`${DAY}T15:00:00Z`);
const cheque = (amountCents) => [{ method: 'cheque', amountCents, internal: false }];

function app() {
  const { model, resourceId, db } = seed({ now: onTheDay });
  const issued = [];
  const issuer = {
    id: 'fake', isReady: () => true,
    async issue(r) { issued.push(r); return { invoiceId: `inv-${issued.length}`, number: `F-${issued.length}`, totalCents: r.expectedTotalCents, clientId: 'c', markedPaid: true }; },
    async findCardBatch() { return null; }, async attach() { return { attachmentId: 'a' }; }, async invoiceStatus() { return 'unpaid'; },
  };
  const invoicing = createInvoicing({ bookings: () => model, issuers: () => issuer, now: onTheDay, logger: { error() {}, warn() {} } });
  const controller = createController({ bookings: () => model, invoicing: () => invoicing });
  const run = async (handler, id, body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await controller[handler]({ params: { id: String(id) }, body }, res);
    return res;
  };
  return { model, resourceId, db, issued, invoicing, run };
}

for (const [label, tenders] of [['cheque', cheque(12000)], ['card', card(12000)]]) {
  test(`rule 45 — paid by ${label} at booking time, Qonto ready: the arrival sent without « invoice » makes no invoice`, async () => {
    const { model, resourceId, issued, run } = app();
    const id = book(model, resourceId);
    model.recordPayment(id, { tenders, paidAt: DAY });
    const res = await run('arrival', id, { payment: null, invoice: false });
    assert.equal(res.code, 200);
    assert.equal(res.body.booking.arrived, true);
    assert.equal(res.body.invoice, null);
    const omitted = await run('arrival', id, { payment: null });
    assert.equal(omitted.code, 200);
    assert.equal(omitted.body.invoice, null);
    assert.equal(issued.length, 0);
    assert.equal(model.findById(id).invoice, null);
  });
}

test('rule 45 — an « invoice » that is not a boolean is refused before the arrival is written', async () => {
  const { model, resourceId, issued, run } = app();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: cheque(12000), paidAt: DAY });
  for (const invoice of ['true', 1, 'yes', {}, [true], null]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await run('arrival', id, { payment: null, invoice });
    assert.equal(res.code, 400, JSON.stringify(invoice));
    assert.equal(res.body.error, 'Facture : oui ou non.');
  }
  assert.equal(model.findById(id).arrived, false);
  assert.equal(issued.length, 0);
});

test('rule 45 — « Créer la facture » (invoice: true) is the explicit choice: arrival then invoice', async () => {
  const { model, resourceId, issued, run } = app();
  const id = book(model, resourceId);
  model.recordPayment(id, { tenders: cheque(12000), paidAt: DAY });
  const res = await run('arrival', id, { payment: null, invoice: true });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.invoice, { ok: true, number: 'F-1' });
  assert.equal(issued.length, 1);
});

test('rule 45 — recording a payment, editing the booking and the hourly job never make an invoice', async () => {
  const { model, resourceId, issued, invoicing, run } = app();
  const id = book(model, resourceId);
  const paid = await run('recordPayment', id, { tenders: card(12000), paidAt: DAY, invoice: true });
  assert.equal(paid.code, 200);
  const edited = await run('update', id, { notes: 'Serviette', invoice: true });
  assert.equal(edited.code, 200);
  await invoicing.watch();
  assert.equal(issued.length, 0);
  assert.equal(model.findById(id).invoice, null);
});
