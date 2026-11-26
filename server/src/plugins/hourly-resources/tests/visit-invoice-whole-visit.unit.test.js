// specs/sas/outside-booking-sas.md rule 31 (reading of 2026-11-15, owner) with rule 34 — a visit whose session was paid on the booking before its document
// and whose drinks or extras are on that document gets ONE invoice covering the whole visit: the session's parts and every money line of the document,
// issued once everything is settled. A visit with no document — or a document holding no money of its own — keeps the booking's invoice exactly.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

const sent = [];
// A Qonto that checks what Qonto checks: the items less the discount make the expected total.
const issuer = {
  id: 'fake',
  isReady: () => true,
  async issue(request) {
    sent.push(request);
    const items = request.items.reduce((sum, item) => sum + item.amountCents, 0) - (request.discount ? request.discount.amountCents : 0);
    if (items !== request.expectedTotalCents) throw Object.assign(new Error('écart'), { code: 'ISSUER_AMOUNT_MISMATCH' });
    return { invoiceId: `inv-${sent.length}`, number: `F-${sent.length}`, clientId: 'c', markedPaid: true };
  },
  async findCardBatch() { return null; },
  async attach() { return { attachmentId: 'a' }; },
  async invoiceStatus() { return 'paid'; },
};
f.setIssuer(issuer);

function paidOnTheBooking(tenders = f.card(12000)) {
  const id = f.bookEvening();
  assert.deepEqual(f.bookings.recordPayment(id, { tenders, paidAt: f.DAY }), { ok: true });
  return id;
}

const itemsOf = (request) => request.items.map((item) => [item.title, item.amountCents, item.vatRate]);

test('rule 31 — session paid on the booking, two beers on the document: one invoice for the whole visit, its total the visit\'s', async () => {
  const id = paidOnTheBooking();
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)], payment: { tenders: f.card(1300) } } });
  sent.length = 0;
  const issued = await f.invoicing.issue(id);
  assert.equal(issued.ok, true);
  assert.equal(sent.length, 1, 'one invoice');
  const [request] = sent;
  assert.deepEqual(itemsOf(request), [
    ['Bain fictif · Jour · 18:00–19:00', 5000, 20], ['Bain fictif · Soir · 19:00–20:00', 7000, 20], ['Bière locale', 1300, 20],
  ]);
  assert.equal(request.discount, null);
  assert.equal(request.expectedTotalCents, 13300);
  assert.equal(request.issueDate, f.DAY);
  const booking = f.bookings.findById(id);
  assert.deepEqual([booking.invoice.number, booking.frozen], ['F-1', true], 'the invoice columns stay on the booking');
  assert.equal((await f.invoicing.issue(id)).code, 'BOOKING_INVOICED', 'never a second invoice');
});

test('rule 31 — the document\'s extras still due: 409 REMAINING_DUE, the session is not invoiced alone', async () => {
  const id = paidOnTheBooking();
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] } });
  sent.length = 0;
  const refused = await f.invoicing.issue(id);
  assert.deepEqual([refused.status, refused.code], [409, 'REMAINING_DUE']);
  assert.equal(sent.length, 0);
});

test('rule 31 — the session\'s own payment in caisse interne: no invoice for the visit', async () => {
  const id = paidOnTheBooking(f.cash(12000, true));
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], payment: { tenders: f.card(650) } } });
  sent.length = 0;
  assert.equal((await f.invoicing.issue(id)).code, 'INTERNAL_CASH');
  assert.equal(sent.length, 0);
});

test('rule 31 — no document, or a document holding only offered lines: the booking\'s invoice, exactly as before', async () => {
  const alone = paidOnTheBooking();
  await f.call('commit', { id: alone, body: {} });
  assert.equal(f.row(alone).saleRef, null);
  sent.length = 0;
  assert.equal((await f.invoicing.issue(alone)).ok, true);
  assert.deepEqual(itemsOf(sent[0]), itemsOf(f.invoicing.requestOf(f.bookings.invoiceBasis(alone))));
  assert.equal(sent[0].expectedTotalCents, 12000);

  const offered = paidOnTheBooking();
  await f.call('commit', { id: offered, body: { extras: [f.extra(f.lemonade, 1, { offered: true })] } });
  sent.length = 0;
  assert.equal((await f.invoicing.issue(offered)).ok, true);
  assert.deepEqual(itemsOf(sent[0]), itemsOf(f.invoicing.requestOf(f.bookings.invoiceBasis(offered))), 'the booking\'s basis, not the document\'s');
  assert.equal(sent[0].expectedTotalCents, 12000);
});
